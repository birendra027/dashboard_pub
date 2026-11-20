"""Best-effort automatic watermark detection.

Camera-stamped watermarks ("Shot on ...", a model name, a date string) are
predictable: small text, hugging a frame corner, and -- in video -- pinned to
the same pixels for the whole clip while the scene behind them moves.

This finds text-like structure in the corner regions and, for video, weights
each candidate by how static it stays. It returns a suggestion for the user to
nudge, never a silent auto-apply.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .inpaint import Box

# Corner windows to search, as fractions of the frame: (x, y, w, h).
# Phone stamps land in a bottom corner far more often than anywhere else, so
# those windows are searched first and the bottom band is generous.
_ZONES = [
    ("bottom-left", (0.00, 0.80, 0.55, 0.20)),
    ("bottom-right", (0.45, 0.80, 0.55, 0.20)),
    ("bottom-center", (0.20, 0.84, 0.60, 0.16)),
    ("top-left", (0.00, 0.00, 0.55, 0.16)),
    ("top-right", (0.45, 0.00, 0.55, 0.16)),
]


@dataclass
class Candidate:
    zone: str
    box: Box
    score: float


def _text_bbox(region: np.ndarray, frame_h: int) -> tuple[tuple[int, int, int, int], float] | None:
    """Locate a run of text inside one zone. Returns a local bbox and a score."""
    if region.size == 0:
        return None

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)

    # A morphological gradient lights up glyph edges while ignoring smooth
    # gradients like sky or bokeh, which is what separates overlay text from
    # ordinary scene content.
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    _, binary = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

    # Close horizontally so neighbouring letters merge into one word blob.
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3)))

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Watermark glyphs occupy a narrow height band relative to the frame.
    min_h, max_h = max(4, int(frame_h * 0.008)), int(frame_h * 0.075)

    keep = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if not (min_h <= h <= max_h):
            continue
        if w < h * 0.6:          # discard isolated specks and vertical noise
            continue
        if w > region.shape[1] * 0.97:  # a full-width band is scene structure
            continue
        keep.append((x, y, w, h))

    if not keep:
        return None

    xs0 = min(x for x, _, _, _ in keep)
    ys0 = min(y for _, y, _, _ in keep)
    xs1 = max(x + w for x, _, w, _ in keep)
    ys1 = max(y + h for _, y, _, h in keep)

    ink = sum(w * h for _, _, w, h in keep)
    span = max(1, (xs1 - xs0) * (ys1 - ys0))
    # Reward zones with a lot of text ink that is tightly packed -- scattered
    # detections across a big empty span are almost always scene detail.
    score = ink * (ink / span)

    return (xs0, ys0, xs1 - xs0, ys1 - ys0), float(score)


def _staticness(path: Path, samples: int = 12) -> np.ndarray | None:
    """Per-pixel temporal standard deviation over sampled frames.

    A burned-in overlay barely changes; the scene behind it does. Returned at
    reduced scale -- it is only used to weight zones, not to place the box.
    """
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total < samples * 2:
        cap.release()
        return None

    idxs = np.linspace(0, total - 1, samples).astype(int)
    stack = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if ok:
            small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
            stack.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32))
    cap.release()

    if len(stack) < 4:
        return None
    return np.std(np.stack(stack), axis=0)


def detect(reference: np.ndarray, video_path: Path | None = None) -> Box | None:
    """Suggest a watermark box, or None if nothing convincing turns up."""
    h, w = reference.shape[:2]
    motion = _staticness(video_path) if video_path is not None else None

    best: Candidate | None = None
    for name, (fx, fy, fw, fh) in _ZONES:
        zx, zy = int(fx * w), int(fy * h)
        zw, zh = int(fw * w), int(fh * h)
        found = _text_bbox(reference[zy:zy + zh, zx:zx + zw], h)
        if found is None:
            continue
        (bx, by, bw, bh), score = found

        if motion is not None:
            # Weight by how still this zone is across the clip: a region that
            # never changes is far more likely an overlay than moving scenery.
            mh, mw = motion.shape
            sy0, sy1 = int(fy * mh), min(mh, int((fy + fh) * mh))
            sx0, sx1 = int(fx * mw), min(mw, int((fx + fw) * mw))
            patch = motion[sy0:sy1, sx0:sx1]
            if patch.size:
                score *= 1.0 / (1.0 + float(patch.mean()))

        cand = Candidate(name, Box(
            x=(zx + bx) / w, y=(zy + by) / h, w=bw / w, h=bh / h,
        ), score)
        if best is None or cand.score > best.score:
            best = cand

    if best is None:
        return None

    # Pad outward a little; the detected bbox tends to clip glyph edges and
    # inpainting needs to cover the full stamp including its soft shadow.
    px, py = best.box.w * 0.06, best.box.h * 0.22
    return Box(
        x=max(0.0, best.box.x - px),
        y=max(0.0, best.box.y - py),
        w=min(1.0, best.box.w + px * 2),
        h=min(1.0, best.box.h + py * 2),
    )
