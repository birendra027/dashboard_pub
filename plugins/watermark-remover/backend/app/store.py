"""In-memory registry of uploaded files and running jobs.

State lives in the process and the bytes live under backend/data. That keeps
the app a single-command local tool: nothing to install, no database, and
uploads never leave the machine.
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .inpaint import Box


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class MediaFile:
    id: str
    name: str
    kind: str
    path: Path
    width: int
    height: int
    size: int
    duration: float | None = None
    fps: float | None = None
    frames: int | None = None
    created: float = field(default_factory=time.time)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "width": self.width,
            "height": self.height,
            "size": self.size,
            "duration": self.duration,
            "previewUrl": f"api/files/{self.id}/preview",
        }


@dataclass
class JobItem:
    file_id: str
    boxes: list[Box]
    status: str = "pending"          # pending | running | done | error
    progress: float = 0.0
    error: str | None = None
    warning: str | None = None       # finished, but something was lost on the way
    output: Path | None = None
    out_name: str | None = None

    def as_dict(self) -> dict:
        return {
            "fileId": self.file_id,
            "status": self.status,
            "progress": round(self.progress, 4),
            "error": self.error,
            "warning": self.warning,
            "outputName": self.out_name,
            "downloadUrl": f"api/jobs/items/{self.file_id}/download" if self.status == "done" else None,
        }


@dataclass
class Job:
    id: str
    items: list[JobItem]
    mode: str = "fast"               # fast | quality
    quality: str = "high"            # CRF preset name; see video.QUALITY_PRESETS
    created: float = field(default_factory=time.time)

    @property
    def status(self) -> str:
        states = {i.status for i in self.items}
        if states <= {"done"}:
            return "done"
        if "running" in states or "pending" in states:
            return "running"
        return "done" if "done" in states else "error"

    @property
    def progress(self) -> float:
        if not self.items:
            return 1.0
        return sum(i.progress for i in self.items) / len(self.items)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 4),
            "mode": self.mode,
            "quality": self.quality,
            "items": [i.as_dict() for i in self.items],
        }


class Store:
    def __init__(self, workers: int = 2) -> None:
        self._lock = threading.Lock()
        self.files: dict[str, MediaFile] = {}
        self.jobs: dict[str, Job] = {}
        # Video work is CPU-bound and ffmpeg already threads internally, so a
        # small pool keeps the machine responsive instead of thrashing it.
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="wm")

    def add_file(self, f: MediaFile) -> None:
        with self._lock:
            self.files[f.id] = f

    def get_file(self, fid: str) -> MediaFile | None:
        return self.files.get(fid)

    def drop_file(self, fid: str) -> bool:
        with self._lock:
            f = self.files.pop(fid, None)
        if f is None:
            return False
        try:
            if f.path.parent.exists():
                for p in f.path.parent.iterdir():
                    p.unlink(missing_ok=True)
                f.path.parent.rmdir()
        except OSError:
            pass
        return True

    def add_job(self, job: Job) -> None:
        with self._lock:
            self.jobs[job.id] = job

    def get_job(self, jid: str) -> Job | None:
        return self.jobs.get(jid)

    def find_item(self, file_id: str) -> JobItem | None:
        """Most recent completed result for a file, across all jobs."""
        newest: tuple[float, JobItem] | None = None
        for job in self.jobs.values():
            for item in job.items:
                if item.file_id == file_id and item.status == "done":
                    if newest is None or job.created > newest[0]:
                        newest = (job.created, item)
        return newest[1] if newest else None


store = Store()
