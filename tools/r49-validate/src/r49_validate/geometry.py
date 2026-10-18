"""Capture geometry the report quotes. Reported, never thresholded."""

from __future__ import annotations

import math
from dataclasses import dataclass

import r49

# A prototype freight car's height above railhead over its width — the only
# shape constant obliquity inflation needs, and scale-independent: both
# dimensions divide by the same ratio. From a typical boxcar, ~15 ft
# rail-to-roof over 10 ft 6 in wide.
_CAR_HEIGHT_OVER_WIDTH = 4570 / 3200


@dataclass(frozen=True)
class Obliquity:
    degrees: float
    """Angle off vertical at the furthest calibrated corner."""
    width_inflation: float
    """Apparent car width there, as a multiple of the nadir width."""


def obliquity_of(manifest: r49.Manifest) -> Obliquity | None:
    """How obliquely the camera sees the far corner of what it calibrated.

    ``θ = atan(ρ_max / h)`` and ``inflation = 1 + (c/w)·tan θ``. The camera is
    assumed over the centre of the calibrated extent and the reference points
    to span the area of interest; both make this a lower bound.

    ``None`` without a camera height, or without two points to measure across.
    """
    calibration = manifest.layout.calibration
    h = calibration.camera_height_mm
    if h is None or len(calibration.points) < 2:
        return None

    xs = [p.world.x for p in calibration.points]
    ys = [p.world.y for p in calibration.points]
    half_diagonal = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) / 2
    if half_diagonal == 0:
        return None

    radians = math.atan(half_diagonal / h)
    return Obliquity(math.degrees(radians), 1 + _CAR_HEIGHT_OVER_WIDTH * math.tan(radians))


def points_off_reference_plane(fit: r49.CalibrationFit) -> int:
    """Reference points the fit left out for sitting off the reference plane.

    Only possible without a camera height: the fit then restricts itself to the
    reference plane, so these points are silently excluded while the
    contributor believes they are being used.
    """
    return sum(1 for p in fit.left_out if p.reason == "off-reference-plane")
