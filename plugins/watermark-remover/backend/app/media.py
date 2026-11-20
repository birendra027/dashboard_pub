"""File probing, decoding and preview generation.

OpenCV handles the common camera formats directly. HEIC/HEIF, which phones
increasingly shoot by default and OpenCV cannot read, goes through Pillow with
the pillow-heif plugin. Anything still unreadable is passed to the bundled
ffmpeg binary as a last resort, so the app needs no system-level install.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np

from .config import IMAGE_EXTS, VIDEO_EXTS, PREVIEW_MAX_EDGE

_FFMPEG: str | None = None

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    _HEIF = True
except ImportError:  # pragma: no cover - optional, only affects HEIC input
    _HEIF = False


def ffmpeg_exe() -> str:
    """Path to the ffmpeg binary bundled with imageio-ffmpeg."""
    global _FFMPEG
    if _FFMPEG is None:
        import imageio_ffmpeg

        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
    return _FFMPEG


def run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    """Invoke ffmpeg with a quiet, non-interactive flag set."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def kind_of(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return "unknown"


# x264 can encode these directly; anything else is converted to 8-bit 4:2:0.
X264_PIX_FMTS = {
    "yuv420p", "yuvj420p", "yuv422p", "yuvj422p", "yuv444p", "yuvj444p",
    "yuv420p10le", "yuv422p10le", "yuv444p10le", "nv12", "nv16", "nv21", "gray",
}

_VIDEO_LINE = re.compile(
    r"Video:\s*[^,]+,\s*([a-z0-9]+)(?:\(([^)]*)\))?", re.IGNORECASE)
_COLOUR_NAMES = {"bt709", "bt470bg", "smpte170m", "bt2020", "bt2020nc", "bt2020c"}


@dataclass
class StreamInfo:
    """Pixel format and colour tags of a video's first video stream.

    Needed so re-encoding does not silently flatten 10-bit HDR footage down to
    8-bit SDR, which is what happens if the pixel format is hard-coded.
    """

    pix_fmt: str = "yuv420p"
    color_range: str | None = None
    colorspace: str | None = None
    primaries: str | None = None
    trc: str | None = None

    @property
    def is_high_bit_depth(self) -> bool:
        return "10le" in self.pix_fmt or "12le" in self.pix_fmt or "p010" in self.pix_fmt

    @property
    def encode_pix_fmt(self) -> str:
        return self.pix_fmt if self.pix_fmt in X264_PIX_FMTS else "yuv420p"


def stream_info(path: Path) -> StreamInfo:
    """Read pixel format and colour tags from ffmpeg's own stream report."""
    out = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)],
                         capture_output=True, text=True).stderr
    m = _VIDEO_LINE.search(out)
    if not m:
        return StreamInfo()

    info = StreamInfo(pix_fmt=m.group(1).lower())
    for part in (m.group(2) or "").split(","):
        part = part.strip().lower()
        if not part or part == "progressive":
            continue
        if part in {"tv", "pc", "limited", "full"}:
            info.color_range = "tv" if part in {"tv", "limited"} else "pc"
        elif "/" in part:
            bits = part.split("/")
            info.colorspace = bits[0] or None
            info.primaries = bits[1] if len(bits) > 1 else None
            info.trc = bits[2] if len(bits) > 2 else None
        elif part in _COLOUR_NAMES:
            # A single colour name means all three tags share it.
            info.colorspace = info.primaries = info.trc = part
    return info


@dataclass
class MediaInfo:
    kind: str
    width: int
    height: int
    duration: float | None = None
    fps: float | None = None
    frames: int | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def _read_via_pillow(path: Path) -> np.ndarray | None:
    """Decode with Pillow, which handles HEIC/HEIF via pillow-heif."""
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as im:
            # Phones record orientation in EXIF rather than rotating pixels.
            im = ImageOps.exif_transpose(im).convert("RGB")
            return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def read_image(path: Path) -> np.ndarray:
    """Decode a still image to BGR, trying OpenCV, then Pillow, then ffmpeg."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is not None:
        return img

    img = _read_via_pillow(path)
    if img is not None:
        return img

    # Last resort: ffmpeg can decode some containers the other two cannot.
    # Transcode to a temporary PNG next to the source, then read that.
    tmp = path.with_suffix(".decoded.png")
    proc = run_ffmpeg(["-i", str(path), str(tmp)])
    if tmp.exists():
        img = cv2.imread(str(tmp), cv2.IMREAD_COLOR)
        tmp.unlink(missing_ok=True)
    if img is None:
        hint = "" if _HEIF else " (install pillow-heif for HEIC support)"
        raise ValueError(
            f"Could not decode image: {path.name}{hint}. {proc.stderr.strip()}"
        )
    return img


def probe(path: Path) -> MediaInfo:
    """Read dimensions and, for video, duration/fps/frame count."""
    kind = kind_of(path)
    if kind == "image":
        img = read_image(path)
        h, w = img.shape[:2]
        return MediaInfo(kind="image", width=w, height=h)

    if kind == "video":
        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {path.name}")
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        duration = (frames / fps) if fps > 0 and frames > 0 else None
        return MediaInfo("video", w, h, duration, fps or None, frames or None)

    raise ValueError(f"Unsupported file type: {path.name}")


def first_frame(path: Path) -> np.ndarray:
    """Grab a representative frame from a video (a little past the start, so
    we skip any fade-in and see the watermark at full opacity)."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {path.name}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total > 10:
        cap.set(cv2.CAP_PROP_POS_FRAMES, min(total // 10, 60))
    ok, frame = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"Could not read any frame from {path.name}")
    return frame


def load_reference(path: Path) -> np.ndarray:
    """The frame/image the UI draws its selection box on top of."""
    return read_image(path) if kind_of(path) == "image" else first_frame(path)


def downscale(img: np.ndarray, max_edge: int = PREVIEW_MAX_EDGE) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def write_preview(img: np.ndarray, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dest), downscale(img), [cv2.IMWRITE_JPEG_QUALITY, 88])
