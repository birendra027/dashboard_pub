"""Watermark removal for stills and video.

Boxes arrive from the UI as normalised floats (0..1) so a region picked on a
downscaled preview maps exactly onto the full-resolution source.

Stills are inpainted with OpenCV's Navier-Stokes algorithm, run on a padded
crop rather than the whole frame -- a 12MP photo would otherwise spend seconds
inpainting pixels nowhere near the watermark. NS is the default over Telea
because it continues smooth gradients (sky, walls, bokeh) essentially
perfectly, which is where corner watermarks usually sit; on heavily textured
backgrounds the two score within 0.2 dB of each other.

Video has two paths: ffmpeg's `delogo` filter (one pass, audio copied through,
fast enough for long clips) and a per-frame OpenCV pass for stubborn cases.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import cv2
import numpy as np

from .media import ffmpeg_exe, run_ffmpeg

ProgressFn = Callable[[float], None]

ALGORITHMS = {"ns": cv2.INPAINT_NS, "telea": cv2.INPAINT_TELEA}
DEFAULT_ALGORITHM = "ns"


@dataclass(frozen=True)
class Box:
    """A watermark region in normalised (0..1) coordinates."""

    x: float
    y: float
    w: float
    h: float

    def to_pixels(self, width: int, height: int) -> tuple[int, int, int, int]:
        x = int(round(self.x * width))
        y = int(round(self.y * height))
        w = int(round(self.w * width))
        h = int(round(self.h * height))
        # Clamp into frame and guarantee a non-empty region.
        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))
        return x, y, w, h

    @staticmethod
    def from_dict(d: dict) -> "Box":
        return Box(float(d["x"]), float(d["y"]), float(d["w"]), float(d["h"]))


def _mask_for(shape: tuple[int, int], regions: Sequence[tuple[int, int, int, int]], grow: int) -> np.ndarray:
    """White where pixels must be reconstructed, grown slightly so the
    anti-aliased fringe around watermark glyphs is covered too."""
    mask = np.zeros(shape, dtype=np.uint8)
    for x, y, w, h in regions:
        cv2.rectangle(mask, (x, y), (x + w - 1, y + h - 1), 255, thickness=-1)
    if grow > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1))
        mask = cv2.dilate(mask, k)
    return mask


def inpaint_image(
    img: np.ndarray,
    boxes: Iterable[Box],
    radius: int = 5,
    grow: int = 3,
    algorithm: str = DEFAULT_ALGORITHM,
) -> np.ndarray:
    """Reconstruct every boxed region from the surrounding pixels."""
    algo = ALGORITHMS.get(algorithm, cv2.INPAINT_NS)
    h, w = img.shape[:2]
    regions = [b.to_pixels(w, h) for b in boxes]
    if not regions:
        return img

    out = img.copy()
    for rx, ry, rw, rh in regions:
        # Work on a padded crop; Telea only needs nearby context to fill from.
        pad = max(24, radius * 4, int(0.35 * max(rw, rh)))
        x0, y0 = max(0, rx - pad), max(0, ry - pad)
        x1, y1 = min(w, rx + rw + pad), min(h, ry + rh + pad)

        patch = out[y0:y1, x0:x1]
        local = [(rx - x0, ry - y0, rw, rh)]
        mask = _mask_for(patch.shape[:2], local, grow)
        filled = cv2.inpaint(patch, mask, radius, algo)
        out[y0:y1, x0:x1] = filled

    return out


def _frame_inpainter(width: int, height: int, boxes: Sequence[Box], radius: int, grow: int,
                     algorithm: str = DEFAULT_ALGORITHM):
    """Precompute per-frame crop windows and masks once, instead of rebuilding
    them for every one of a video's thousands of frames."""
    algo = ALGORITHMS.get(algorithm, cv2.INPAINT_NS)
    plans = []
    for b in boxes:
        rx, ry, rw, rh = b.to_pixels(width, height)
        pad = max(24, radius * 4, int(0.35 * max(rw, rh)))
        x0, y0 = max(0, rx - pad), max(0, ry - pad)
        x1, y1 = min(width, rx + rw + pad), min(height, ry + rh + pad)
        mask = _mask_for((y1 - y0, x1 - x0), [(rx - x0, ry - y0, rw, rh)], grow)
        plans.append((x0, y0, x1, y1, mask))

    def apply(frame: np.ndarray) -> np.ndarray:
        for x0, y0, x1, y1, mask in plans:
            frame[y0:y1, x0:x1] = cv2.inpaint(frame[y0:y1, x0:x1], mask, radius, algo)
        return frame

    return apply
