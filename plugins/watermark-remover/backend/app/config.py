"""Runtime paths and limits for the watermark remover service."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
PREVIEW_DIR = DATA_DIR / "previews"
OUTPUT_DIR = DATA_DIR / "outputs"

for _d in (UPLOAD_DIR, PREVIEW_DIR, OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp"}

# Longest edge of the preview served to the browser. Keeps the UI snappy on
# 12MP phone photos while staying sharp enough to place the box precisely.
PREVIEW_MAX_EDGE = 1400

# Guard rails so a stray upload cannot fill the disk.
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB

# Files older than this are swept on startup.
RETENTION_HOURS = 24
