"""The calibration fit, as FORMAT.md § The calibration fit defines it."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from .data import SCALE_TO_RATIO, STANDARD_GAUGE
from .manifest import Calibration, Manifest

LeftOutReason = Literal["off-reference-plane", "above-camera", "no-partner"]
"""Why a reference point is not in the fit, in FORMAT.md's order:

* ``off-reference-plane``: there is no camera height and the point's ``z`` is
  not the reference height.
* ``above-camera``: the point's ``z`` is the camera height or more.
* ``no-partner``: no other point still in the fit has the same ``z``.
"""


@dataclass(frozen=True)
class LeftOut:
    """A reference point the fit does not use."""

    index: int
    """The point's index in ``calibration.points``."""
    reason: LeftOutReason


@dataclass(frozen=True)
class CalibrationFit:
    """What a fit reports, together."""

    dpt: float | None
    """DPT, or None where it does not resolve: no pair with a nonzero separation,
    or a camera height at or below the reference height."""
    residual: float | None
    """The RMS residual in image pixels, or None with fewer than two pairs."""
    pairs: tuple[tuple[int, int], ...]
    """The pairs used, each by the indexes of its two points, the lower first."""
    left_out: tuple[LeftOut, ...]
    """The points left out, by index, each with the first reason that applies."""
    camera_height_fits: bool | None
    """None without a camera height; otherwise whether it is above every
    reference point's ``z``. False is no format error, but the DPT should not
    be trusted."""


def fit(manifest: Manifest) -> CalibrationFit:
    """Fit the layout's scale through its reference points.

    ``d_mm²`` weighting trusts long baselines more; heights compare exactly,
    because they are typed by hand.
    """
    calibration = manifest.layout.calibration
    h = calibration.camera_height_mm
    z_ref = calibration.reference_height_mm or 0.0

    left_out, pairs = _select(calibration)
    separations = [_separations(calibration, i, j) for i, j in pairs]

    numerator = sum(d_px * d_mm for d_px, d_mm in separations)
    denominator = sum(d_mm * d_mm for _, d_mm in separations)
    scale = numerator / denominator if denominator != 0 else None

    dpt: float | None = None
    if scale is not None and (h is None or h > z_ref):
        # Without a camera height the fit already sits on the reference plane;
        # with one it is at layout zero, and this lifts it to the track.
        at_reference = scale if h is None else scale * h / (h - z_ref)
        dpt = at_reference * STANDARD_GAUGE / SCALE_TO_RATIO[manifest.layout.scale]

    residual: float | None = None
    if scale is not None and len(separations) >= 2:
        residual = math.sqrt(
            sum((d_px - scale * d_mm) ** 2 for d_px, d_mm in separations) / len(separations)
        )

    fits: bool | None = None
    if h is not None:
        fits = all(point.reason != "above-camera" for point in left_out)

    return CalibrationFit(
        dpt=dpt,
        residual=residual,
        pairs=tuple(pairs),
        left_out=tuple(left_out),
        camera_height_fits=fits,
    )


def _select(calibration: Calibration) -> tuple[list[LeftOut], list[tuple[int, int]]]:
    """The points left out and the pairs: every unordered pair of the rest that
    shares a ``z``."""
    h = calibration.camera_height_mm
    z_ref = calibration.reference_height_mm or 0.0
    points = calibration.points

    left_out: dict[int, LeftOutReason] = {}
    for index, point in enumerate(points):
        if h is None and point.world.z != z_ref:
            left_out[index] = "off-reference-plane"
        elif h is not None and point.world.z >= h:
            left_out[index] = "above-camera"

    kept = [index for index in range(len(points)) if index not in left_out]
    pairs = [
        (i, j)
        for n, i in enumerate(kept)
        for j in kept[n + 1 :]
        if points[i].world.z == points[j].world.z
    ]
    paired = {index for pair in pairs for index in pair}
    for index in kept:
        if index not in paired:
            left_out[index] = "no-partner"

    return [LeftOut(index, left_out[index]) for index in sorted(left_out)], pairs


def _separations(calibration: Calibration, i: int, j: int) -> tuple[float, float]:
    """A pair's pixel separation, scaled to layout zero when the camera height
    is known, and its separation on the layout in mm."""
    a, b = calibration.points[i], calibration.points[j]
    h = calibration.camera_height_mm
    d_px = math.hypot(a.px.x - b.px.x, a.px.y - b.px.y)
    if h is not None:
        d_px *= (h - a.world.z) / h
    return d_px, math.hypot(a.world.x - b.world.x, a.world.y - b.world.y)
