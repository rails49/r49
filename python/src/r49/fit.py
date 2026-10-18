"""The calibration fit, as FORMAT.md § The calibration fit defines it.

One result carries everything a reader filters on: DPT, the residual, the
pairs that entered the fit, the reference points left out and why, and whether
the camera height fits the points.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from ._data import SCALE_TO_RATIO, STANDARD_GAUGE
from .manifest import Manifest

LeftOutReason = Literal["off-reference-plane", "above-camera", "no-partner"]


@dataclass(frozen=True)
class Pair:
    """Two reference points at one height, reduced to the separations the fit sees."""

    a: int
    """Index of the first point in ``layout.calibration.points``."""
    b: int
    """Index of the second point; always greater than ``a``."""
    d_px: float
    """Separation in image pixels, normalized to layout zero when the camera height is known."""
    d_mm: float
    """Separation on the layout, in mm."""


@dataclass(frozen=True)
class LeftOut:
    """A reference point that entered no pair, and the first reason that applies."""

    point: int
    reason: LeftOutReason


@dataclass(frozen=True)
class CalibrationFit:
    dpt: float | None
    """Dots per track on the reference plane, or ``None`` when calibration does not resolve."""
    residual: float | None
    """RMS disagreement of the pairs with the fitted scale, in pixels; ``None`` below two pairs."""
    pairs: tuple[Pair, ...]
    left_out: tuple[LeftOut, ...]
    camera_height_fits: bool | None
    """Whether the camera clears the reference plane and every point; ``None`` without one."""


def gauge_mm(scale: str) -> float:
    """A scale's model track gauge in mm: the standard gauge over the scale's ratio."""
    return STANDARD_GAUGE / SCALE_TO_RATIO[scale]


def calibration_fit(manifest: Manifest) -> CalibrationFit:
    """Compute the calibration fit of a manifest."""
    calibration = manifest.layout.calibration
    points = calibration.points
    h = calibration.camera_height_mm
    z_ref = calibration.reference_height_mm if calibration.reference_height_mm is not None else 0.0

    reasons: dict[int, LeftOutReason] = {}
    for i, point in enumerate(points):
        z = point.world.z
        if h is None and z != z_ref:
            reasons[i] = "off-reference-plane"
        elif h is not None and z >= h:
            reasons[i] = "above-camera"

    pairs: list[Pair] = []
    for i, a in enumerate(points):
        for j in range(i + 1, len(points)):
            b = points[j]
            if i in reasons or j in reasons or a.world.z != b.world.z:
                continue
            d_px = math.hypot(a.px.x - b.px.x, a.px.y - b.px.y)
            if h is not None:
                d_px = d_px * ((h - a.world.z) / h)
            d_mm = math.hypot(a.world.x - b.world.x, a.world.y - b.world.y)
            pairs.append(Pair(i, j, d_px, d_mm))

    paired = {p.a for p in pairs} | {p.b for p in pairs}
    for i in range(len(points)):
        if i not in reasons and i not in paired:
            reasons[i] = "no-partner"

    numerator = sum(p.d_px * p.d_mm for p in pairs)
    denominator = sum(p.d_mm * p.d_mm for p in pairs)
    scale = None if denominator == 0 else numerator / denominator

    dpt: float | None = None
    if scale is not None and (h is None or h > z_ref):
        at_reference = scale if h is None else scale * (h / (h - z_ref))
        dpt = at_reference * gauge_mm(manifest.layout.scale)

    residual: float | None = None
    if scale is not None and len(pairs) >= 2:
        residual = math.sqrt(sum((p.d_px - scale * p.d_mm) ** 2 for p in pairs) / len(pairs))

    fits: bool | None = None
    if h is not None:
        fits = h > z_ref and all(h > p.world.z for p in points)

    return CalibrationFit(
        dpt=dpt,
        residual=residual,
        pairs=tuple(pairs),
        left_out=tuple(LeftOut(i, reasons[i]) for i in sorted(reasons)),
        camera_height_fits=fits,
    )
