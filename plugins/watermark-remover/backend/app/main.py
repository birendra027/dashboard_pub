"""FastAPI application: upload, detect, process, download.

Everything runs locally -- files are read from disk, processed in a worker
thread, and written back beside the upload. Nothing is sent anywhere.
"""
from __future__ import annotations

import io
import shutil
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import detect as detector
from . import media, video
from .config import (MAX_UPLOAD_BYTES, OUTPUT_DIR, PREVIEW_DIR, RETENTION_HOURS,
                     UPLOAD_DIR)
from .inpaint import Box, inpaint_image
from .store import Job, JobItem, MediaFile, new_id, store

WRITABLE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def sweep_old_data() -> None:
    """Drop anything left behind by a previous run past its retention window."""
    cutoff = time.time() - RETENTION_HOURS * 3600
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        for child in root.glob("*"):
            try:
                if child.stat().st_mtime >= cutoff:
                    continue
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
            except OSError:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    sweep_old_data()
    yield
    store.pool.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="Watermark Remover", version="1.0.0", lifespan=lifespan)

# The Vite dev server runs on a different port; in production the built
# frontend is served from this same origin and CORS is moot.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# request models
# --------------------------------------------------------------------------

class BoxIn(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class JobItemIn(BaseModel):
    fileId: str
    boxes: list[BoxIn]


class JobIn(BaseModel):
    items: list[JobItemIn]
    mode: str = "fast"
    quality: str = video.DEFAULT_QUALITY


# --------------------------------------------------------------------------
# health
# --------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    try:
        ffmpeg = media.ffmpeg_exe()
        ok = Path(ffmpeg).exists()
    except Exception as exc:  # pragma: no cover - only on a broken install
        return {"status": "ok", "ffmpeg": False, "ffmpegPath": None, "detail": str(exc)}
    return {"status": "ok", "ffmpeg": ok, "ffmpegPath": ffmpeg if ok else None}


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------

@app.post("/api/files")
async def upload(files: list[UploadFile] = File(...)) -> dict:
    added, rejected = [], []

    for up in files:
        name = Path(up.filename or "upload").name
        kind = media.kind_of(Path(name))
        if kind == "unknown":
            rejected.append({"name": name, "reason": "Unsupported file type"})
            await up.close()
            continue

        fid = new_id()
        dest_dir = UPLOAD_DIR / fid
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / ("source" + Path(name).suffix.lower())

        written = 0
        try:
            with dest.open("wb") as fh:
                while True:
                    chunk = await up.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        raise ValueError("File exceeds the 2 GB limit")
                    fh.write(chunk)

            info = media.probe(dest)
            media.write_preview(media.load_reference(dest), PREVIEW_DIR / (fid + ".jpg"))
        except Exception as exc:
            shutil.rmtree(dest_dir, ignore_errors=True)
            # Decoders report the on-disk name ("source.jpg"); show the user
            # the name they actually uploaded.
            rejected.append({"name": name, "reason": str(exc).replace(dest.name, name)})
            continue
        finally:
            await up.close()

        mf = MediaFile(
            id=fid, name=name, kind=info.kind, path=dest,
            width=info.width, height=info.height, size=written,
            duration=info.duration, fps=info.fps, frames=info.frames,
        )
        store.add_file(mf)
        added.append(mf.as_dict())

    return {"files": added, "rejected": rejected}


@app.get("/api/files/{file_id}/preview")
def preview(file_id: str) -> FileResponse:
    if store.get_file(file_id) is None:
        raise HTTPException(404, "File not found")
    path = PREVIEW_DIR / (file_id + ".jpg")
    if not path.exists():
        raise HTTPException(404, "Preview not available")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/files/{file_id}/detect")
def auto_detect(file_id: str) -> dict:
    mf = store.get_file(file_id)
    if mf is None:
        raise HTTPException(404, "File not found")

    reference = media.load_reference(mf.path)
    box = detector.detect(reference, mf.path if mf.kind == "video" else None)
    if box is None:
        return {"box": None}
    return {"box": {"x": box.x, "y": box.y, "w": box.w, "h": box.h}}


@app.delete("/api/files/{file_id}")
def remove_file(file_id: str) -> dict:
    if not store.drop_file(file_id):
        raise HTTPException(404, "File not found")
    (PREVIEW_DIR / (file_id + ".jpg")).unlink(missing_ok=True)
    shutil.rmtree(OUTPUT_DIR / file_id, ignore_errors=True)
    return {"deleted": file_id}


# --------------------------------------------------------------------------
# processing
# --------------------------------------------------------------------------

def _process(item: JobItem, mode: str, quality: str) -> None:
    mf = store.get_file(item.file_id)
    if mf is None:
        item.status, item.error = "error", "Source file is no longer available"
        return

    item.status = "running"
    out_dir = OUTPUT_DIR / mf.id
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(mf.name).stem

    def report(fraction: float) -> None:
        item.progress = fraction

    try:
        if mf.kind == "image":
            # Fall back to JPEG for formats OpenCV can read but not write.
            suffix = Path(mf.name).suffix.lower()
            if suffix not in WRITABLE_IMAGE_EXTS:
                suffix = ".jpg"
            dst = out_dir / (stem + "_clean" + suffix)

            cleaned = inpaint_image(media.read_image(mf.path), item.boxes)
            params = [cv2.IMWRITE_JPEG_QUALITY, 96] if suffix in {".jpg", ".jpeg"} else []
            if not cv2.imwrite(str(dst), cleaned, params):
                raise RuntimeError("Failed to write the cleaned image")
            report(1.0)
        else:
            dst = out_dir / (stem + "_clean.mp4")
            if mode == "quality":
                # This path decodes through OpenCV, which is 8-bit only.
                if media.stream_info(mf.path).is_high_bit_depth:
                    item.warning = ("10-bit source converted to 8-bit by the Best "
                                    "method; use Fast to keep the original depth")
                video.remove_quality(mf.path, dst, item.boxes, mf.width, mf.height,
                                     mf.fps, mf.frames, report, quality)
            else:
                video.remove_fast(mf.path, dst, item.boxes, mf.width, mf.height,
                                  mf.duration, report, quality)

        item.output = dst
        item.out_name = dst.name
        item.status = "done"
    except Exception as exc:
        item.status, item.error, item.progress = "error", str(exc), 0.0


@app.post("/api/jobs")
def create_job(payload: JobIn) -> dict:
    if not payload.items:
        raise HTTPException(400, "No files selected")
    if payload.mode not in {"fast", "quality"}:
        raise HTTPException(400, "mode must be 'fast' or 'quality'")
    if payload.quality not in video.QUALITY_PRESETS:
        raise HTTPException(
            400, "quality must be one of " + ", ".join(video.QUALITY_PRESETS))

    items: list[JobItem] = []
    for spec in payload.items:
        if store.get_file(spec.fileId) is None:
            raise HTTPException(404, "Unknown file: " + spec.fileId)
        if not spec.boxes:
            raise HTTPException(400, "Each file needs at least one region")
        items.append(JobItem(
            file_id=spec.fileId,
            boxes=[Box(b.x, b.y, b.w, b.h) for b in spec.boxes],
        ))

    job = Job(id=new_id(), items=items, mode=payload.mode)
    job.quality = payload.quality
    store.add_job(job)
    for item in items:
        store.pool.submit(_process, item, payload.mode, payload.quality)
    return job.as_dict()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job.as_dict()


@app.get("/api/jobs/items/{file_id}/download")
def download_one(file_id: str) -> FileResponse:
    item = store.find_item(file_id)
    if item is None or item.output is None or not item.output.exists():
        raise HTTPException(404, "No cleaned file ready for this upload")
    return FileResponse(item.output, filename=item.output.name,
                        media_type="application/octet-stream")


@app.get("/api/jobs/{job_id}/download-all")
def download_all(job_id: str) -> StreamingResponse:
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")

    ready = [i for i in job.items if i.status == "done" and i.output and i.output.exists()]
    if not ready:
        raise HTTPException(404, "Nothing finished yet")

    buf = io.BytesIO()
    # Media is already compressed; ZIP_STORED avoids a pointless second pass.
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for item in ready:
            zf.write(item.output, arcname=item.output.name)
    buf.seek(0)

    disposition = 'attachment; filename="cleaned_' + job_id + '.zip"'
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": disposition})


# --------------------------------------------------------------------------
# built frontend (production); harmless when the build has not been made yet
# --------------------------------------------------------------------------

_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="ui")
