from __future__ import annotations

from typing import Any

import pytest
import r49

from r49_validate.geometry import obliquity_of, points_off_reference_plane

# The corners of a 2 x 1 m layout.
CORNERS: list[dict[str, Any]] = [
    {"px": {"x": 0, "y": 0}, "world": {"x": 0, "y": 0, "z": 0}},
    {"px": {"x": 1000, "y": 500}, "world": {"x": 2000, "y": 1000, "z": 0}},
]


def manifest(calibration: dict[str, Any], scale: str = "HO") -> r49.Manifest:
    return r49.parse_manifest(
        {
            "version": 4,
            "layout": {"scale": scale, "calibration": calibration},
            "camera": {"resolution": {"width": 1920, "height": 1080}},
        }
    )


def test_reproduces_the_2x1_m_layout_under_a_1_m_camera() -> None:
    o = obliquity_of(manifest({"points": CORNERS, "camera_height_mm": 1000}))
    assert o is not None
    assert o.degrees == pytest.approx(48.2, abs=0.05)
    assert o.width_inflation == pytest.approx(2.6, abs=0.05)


def test_falls_with_mount_height() -> None:
    def at(h: float) -> float:
        o = obliquity_of(manifest({"points": CORNERS, "camera_height_mm": h}))
        assert o is not None
        return o.width_inflation

    assert at(2000) == pytest.approx(1.8, abs=0.05)
    assert at(3000) == pytest.approx(1.53, abs=0.05)
    assert at(3000) < at(2000) < at(1000)


def test_is_scale_independent() -> None:
    def inflation(scale: str) -> float:
        o = obliquity_of(manifest({"points": CORNERS, "camera_height_mm": 1000}, scale))
        assert o is not None
        return o.width_inflation

    assert inflation("N") == pytest.approx(inflation("HO"), abs=1e-12)


def test_cannot_answer_without_a_height_or_an_extent() -> None:
    assert obliquity_of(manifest({"points": CORNERS})) is None
    assert obliquity_of(manifest({"points": [], "camera_height_mm": 1000})) is None
    assert obliquity_of(manifest({"points": CORNERS[:1], "camera_height_mm": 1000})) is None
    same = [CORNERS[0], CORNERS[0]]
    assert obliquity_of(manifest({"points": same, "camera_height_mm": 1000})) is None


def at(z: float) -> dict[str, Any]:
    return {"px": {"x": 0, "y": 0}, "world": {"x": 0, "y": 0, "z": z}}


def off_plane(calibration: dict[str, Any]) -> int:
    return points_off_reference_plane(r49.calibration_fit(manifest(calibration)))


def test_counts_points_the_fit_excludes_against_the_reference_plane() -> None:
    assert off_plane({"points": [at(0), at(0), at(85)]}) == 1
    assert off_plane({"points": [at(0), at(85), at(85)], "reference_height_mm": 85}) == 1


def test_counts_nothing_once_a_camera_height_makes_every_point_contribute() -> None:
    assert off_plane({"points": [at(0), at(85)], "camera_height_mm": 1150}) == 0
    assert off_plane({"points": [at(0), at(0)]}) == 0
