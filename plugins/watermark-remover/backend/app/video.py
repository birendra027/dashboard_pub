"""Video watermark removal.

Both strategies re-encode the video stream -- there is no way to alter pixels
without doing so -- and both keep the original audio, timing and metadata.

Output size will usually differ from the source, often substantially smaller.
That is CRF doing its job: a phone encodes at a fixed high bitrate in hardware
regardless of how simple the scene is, while x264 at a constant quality target
spends only the bits the picture actually needs. Fewer bytes at the same
visual quality, not less picture. QUALITY_PRESETS exposes that trade-off.

Two strategies, both keeping the original audio track:

  fast    -- ffmpeg's `delogo` filter. One decode/encode pass, interpolating
             each boxed region from its border. Handles a 4K clip in roughly
             real time and is the right default for a static corner stamp.

  quality -- decode with OpenCV, inpaint every frame, re-encode and
             remux the original audio back on. Several times slower, but
             reconstructs the region far better than delogo does.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Callable, Sequence

import cv2
import numpy as np

from . import media
from .inpaint import Box, _frame_inpainter
from .media import ffmpeg_exe, run_ffmpeg

ProgressFn = Callable[[float], None]

_OUT_TIME = re.compile(rb"out_time_us=(\d+)")

# CRF is a quality target: lower means better and bigger. 18 is the usual
# "visually lossless" mark; 14 is for keeping as much as possible.
QUALITY_PRESETS: dict[str, int] = {
    "maximum": 14,   # near-transparent, largest files
    "high": 18,      # default; visually indistinguishable in practice
    "balanced": 22,
    "compact": 27,   # noticeably smaller, some softening
}
DEFAULT_QUALITY = "high"

# `medium` costs a little more time than `veryfast` and gives markedly better
# quality per bit, which matters when the point is to preserve the original.
ENCODE_PRESET = "medium"


def _encode_args(info: "media.StreamInfo", quality: str) -> list[str]:
    """Video encoder flags that preserve bit depth and colour of the source."""
    crf = QUALITY_PRESETS.get(quality, QUALITY_PRESETS[DEFAULT_QUALITY])
    args = [
        "-c:v", "libx264",
        "-crf", str(crf),
        "-preset", ENCODE_PRESET,
        "-pix_fmt", info.encode_pix_fmt,
    ]
    # Carry the colour tags through, otherwise HDR footage is written as
    # untagged SDR and plays back washed out.
    if info.colorspace:
        args += ["-colorspace", info.colorspace]
    if info.primaries:
        args += ["-color_primaries", info.primaries]
    if info.trc:
        args += ["-color_trc", info.trc]
    if info.color_range:
        args += ["-color_range", info.color_range]
    return args


def _delogo_chain(boxes: Sequence[Box], width: int, height: int) -> str:
    """Build a comma-joined delogo filter chain.

    delogo samples the pixels just outside the rectangle, so the region must
    keep a one-pixel margin from every frame edge -- a watermark flush against
    the bottom is nudged inward rather than rejected.
    """
    parts = []
    for b in boxes:
        x, y, w, h = b.to_pixels(width, height)
        x = max(1, x)
        y = max(1, y)
        w = max(1, min(w, width - x - 1))
        h = max(1, min(h, height - y - 1))
        parts.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
    return ",".join(parts)


def _run_with_progress(args: list[str], duration: float | None, progress: ProgressFn) -> None:
    """Stream ffmpeg's machine-readable progress into the job's callback."""
    cmd = [
        ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        *args, "-progress", "pipe:1", "-nostats",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None

    for line in proc.stdout:
        if duration and duration > 0:
            m = _OUT_TIME.search(line)
            if m:
                done = int(m.group(1)) / 1_000_000.0
                progress(max(0.0, min(0.99, done / duration)))

    proc.wait()
    if proc.returncode != 0:
        err = proc.stderr.read().decode("utf-8", "replace").strip() if proc.stderr else ""
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {err[-600:]}")


def remove_fast(src: Path, dst: Path, boxes: Sequence[Box], width: int, height: int,
                duration: float | None, progress: ProgressFn,
                quality: str = DEFAULT_QUALITY) -> None:
    """Single-pass delogo. Audio is copied untouched; bit depth, colour and
    container metadata (creation time, location) are carried across."""
    info = media.stream_info(src)
    _run_with_progress(
        [
            "-i", str(src),
            "-vf", _delogo_chain(boxes, width, height),
            *_encode_args(info, quality),
            "-c:a", "copy",
            "-map_metadata", "0",
            "-movflags", "+faststart",
            str(dst),
        ],
        duration,
        progress,
    )
    progress(1.0)


def remove_quality(src: Path, dst: Path, boxes: Sequence[Box], width: int, height: int,
                   fps: float | None, frames: int | None, progress: ProgressFn,
                   quality: str = DEFAULT_QUALITY) -> None:
    """Per-frame inpainting, then remux the source audio.

    OpenCV decodes to 8-bit BGR, so this path cannot preserve a 10-bit source;
    `remove_fast` can. Callers check `media.stream_info(src).is_high_bit_depth`
    to warn about that before choosing this route.
    """
    import imageio_ffmpeg

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open {src.name}")

    fps = fps or cap.get(cv2.CAP_PROP_FPS) or 30.0
    apply = _frame_inpainter(width, height, boxes, radius=5, grow=3)
    silent = dst.with_name(dst.stem + ".silent.mp4")

    crf = QUALITY_PRESETS.get(quality, QUALITY_PRESETS[DEFAULT_QUALITY])
    writer = imageio_ffmpeg.write_frames(
        str(silent), size=(width, height), fps=fps, codec="libx264",
        pix_fmt_in="bgr24", pix_fmt_out="yuv420p", quality=None,
        macro_block_size=1,
        output_params=["-crf", str(crf), "-preset", ENCODE_PRESET],
    )
    writer.send(None)  # prime the generator

    try:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            writer.send(np.ascontiguousarray(apply(frame)).tobytes())
            i += 1
            if frames and i % 10 == 0:
                progress(min(0.97, i / frames))
    finally:
        cap.release()
        writer.close()

    # Copy the cleaned video alongside the untouched original audio. The `?`
    # on the audio map makes a silent source a non-error.
    proc = run_ffmpeg([
        "-i", str(silent), "-i", str(src),
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "copy", "-c:a", "copy", "-shortest",
        "-map_metadata", "1",           # creation time, location, orientation
        "-movflags", "+faststart", str(dst),
    ])
    if proc.returncode != 0 or not dst.exists():
        # No audio stream to merge, or the container rejected the copy --
        # the silent render is still a valid result.
        silent.replace(dst)
    else:
        silent.unlink(missing_ok=True)

    progress(1.0)
