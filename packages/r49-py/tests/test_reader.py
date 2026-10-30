"""The reader beyond what a conformance case asserts: loading from a path, the
bytes it hands back, the image mismatches in order, the whole fit result and
the vocabulary questions."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

import r49

JPEG = b"\xff\xd8\xff\xd9"


def manifest(calibration: dict[str, Any] | None = None, **extra: Any) -> r49.Manifest:
    layout: dict[str, Any] = {"scale": "HO"}
    if calibration is not None:
        layout["calibration"] = calibration
    data = {"version": 4, "layout": layout, "camera": {"resolution": {"width": 4, "height": 3}}}
    return r49.parse_manifest(json.dumps(data | extra).encode())


def point(x: float, y: float, z: float) -> dict[str, Any]:
    """A reference point whose image position is its layout position."""
    return {"px": {"x": x, "y": y}, "world": {"x": x, "y": y, "z": z}}


def zipped(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buffer.getvalue()


ARCHIVE = zipped(
    {
        "manifest.json": json.dumps(
            {
                "version": 4,
                "layout": {"scale": "N"},
                "camera": {"resolution": {"width": 4, "height": 3}},
                "images": [{"filename": "shots/a.jpg"}],
            }
        ).encode(),
        "shots/a.jpg": JPEG,
    }
)


class TestLoad:
    def test_reads_the_same_archive_from_a_path_as_from_bytes(self, tmp_path: Path) -> None:
        path = tmp_path / "layout.r49"
        path.write_bytes(ARCHIVE)
        assert r49.load(path).manifest == r49.load(ARCHIVE).manifest == r49.load(str(path)).manifest

    def test_hands_back_image_bytes_by_manifest_filename(self) -> None:
        archive = r49.load(ARCHIVE)
        assert archive.image(archive.manifest.images[0].filename) == JPEG
        assert archive.image("absent.jpg") is None

    def test_lists_every_file_including_the_manifest(self) -> None:
        assert sorted(r49.load(ARCHIVE).entries()) == ["manifest.json", "shots/a.jpg"]

    def test_reads_absent_optional_keys_as_the_format_says(self) -> None:
        image = r49.load(ARCHIVE).manifest.images[0]
        assert (image.labeled_complete, image.labels) == (False, [])
        assert "labels" not in image.model_fields_set
        layout = r49.load(ARCHIVE).manifest.layout
        assert layout.centerlines == []
        assert "centerlines" not in layout.model_fields_set

    def test_reads_centerline_points_in_order(self) -> None:
        centerline = {"points": [{"x": 2, "y": 3}, {"x": 0, "y": 1}]}
        data = {
            "version": 4,
            "layout": {"scale": "HO", "centerlines": [centerline]},
            "camera": {"resolution": {"width": 4, "height": 3}},
        }
        layout = r49.parse_manifest(json.dumps(data).encode()).layout
        points = [r49.Point(x=2, y=3), r49.Point(x=0, y=1)]
        assert layout.centerlines == [r49.Centerline(points=points)]

    def test_names_the_rule_when_refusing(self) -> None:
        with pytest.raises(r49.R49Error) as refused:
            r49.load(zipped({"manifest.json": b"{}", "stray.txt": b""}))
        assert refused.value.rule == "manifest/version"

    def test_reports_missing_images_then_orphans(self) -> None:
        data = {
            "version": 4,
            "layout": {"scale": "HO"},
            "camera": {"resolution": {"width": 4, "height": 3}},
            "images": [{"filename": "a.jpg"}, {"filename": "b.jpg"}],
        }
        archive = r49.load(
            zipped({"manifest.json": json.dumps(data).encode(), "c.jpg": JPEG, "a.jpg": JPEG})
        )
        assert archive.image_mismatches() == [
            r49.ImageMismatch("images/missing", "b.jpg"),
            r49.ImageMismatch("images/orphan", "c.jpg"),
        ]
        assert r49.load(ARCHIVE).image_mismatches() == []

    def test_reads_class_under_its_manifest_key(self) -> None:
        label = {
            "id": "a",
            "class": "stock.loco",
            "p0": {"x": 0, "y": 0},
            "p1": {"x": 1, "y": 1},
            "provenance": "corrected",
            "proposed_by": "v1",
        }
        read = manifest(images=[{"filename": "a.jpg", "labels": [label]}]).images[0].labels[0]
        assert (read.class_, read.provenance, read.proposed_by) == ("stock.loco", "corrected", "v1")


class TestFit:
    def test_uses_the_typescript_packages_names(self) -> None:
        assert {"calibration_fit", "LeftOutPoint", "CalibrationPair"} <= set(r49.__all__)
        assert not hasattr(r49, "fit")
        assert not hasattr(r49, "LeftOut")

    def test_reports_pairs_by_point_index(self) -> None:
        result = r49.calibration_fit(
            manifest(
                {
                    "points": [point(0, 0, 0), point(0, 0, 9), point(10, 0, 0), point(0, 10, 9)],
                    "camera_height_mm": 100,
                }
            )
        )
        assert result.pairs == ((0, 2), (1, 3))
        assert result.left_out == ()

    def test_leaves_out_points_off_the_reference_plane_without_a_camera_height(self) -> None:
        result = r49.calibration_fit(
            manifest({"points": [point(0, 0, 0), point(10, 0, 0), point(0, 10, 5)]})
        )
        assert result.left_out == (r49.LeftOutPoint(2, "off-reference-plane"),)
        assert result.camera_height_fits is None

    def test_leaves_out_points_at_or_above_the_camera(self) -> None:
        points = [point(0, 0, 0), point(10, 0, 0), point(0, 10, 100), point(5, 5, 120)]
        result = r49.calibration_fit(manifest({"points": points, "camera_height_mm": 100}))
        assert result.left_out == (
            r49.LeftOutPoint(2, "above-camera"),
            r49.LeftOutPoint(3, "above-camera"),
        )
        assert result.camera_height_fits is False

    def test_leaves_out_a_point_with_no_partner_at_its_height(self) -> None:
        points = [point(0, 0, 0), point(10, 0, 0), point(0, 10, 7)]
        result = r49.calibration_fit(manifest({"points": points, "camera_height_mm": 100}))
        assert result.left_out == (r49.LeftOutPoint(2, "no-partner"),)
        assert result.pairs == ((0, 1),)

    def test_reports_the_first_reason_that_applies(self) -> None:
        # Alone at its height and off the reference plane: off the plane wins.
        result = r49.calibration_fit(
            manifest({"points": [point(0, 0, 3)], "reference_height_mm": 0})
        )
        assert result.left_out == (r49.LeftOutPoint(0, "off-reference-plane"),)

    def test_camera_height_fits_when_above_every_point(self) -> None:
        points = [point(0, 0, 0), point(10, 0, 0)]
        fits = r49.calibration_fit(manifest({"points": points, "camera_height_mm": 1}))
        assert fits.camera_height_fits is True
        empty = r49.calibration_fit(manifest({"points": [], "camera_height_mm": 5}))
        assert empty.camera_height_fits is True
        below = r49.calibration_fit(
            manifest({"points": [point(0, 0, 230)], "camera_height_mm": 115})
        )
        assert below.camera_height_fits is False

    def test_has_no_dpt_with_the_camera_at_or_below_the_reference_plane(self) -> None:
        points = [point(0, 0, 0), point(10, 0, 0)]
        result = r49.calibration_fit(
            manifest({"points": points, "camera_height_mm": 1, "reference_height_mm": 1})
        )
        assert (result.camera_height_fits, result.dpt) == (True, None)


class TestVocabulary:
    def test_knows_classes_in_the_data_file_segment_by_segment(self) -> None:
        assert r49.is_known_class("stock.loco.steam")
        assert not r49.is_known_class("stockyard")
        assert not r49.is_known_class("loco.steam")
        assert not r49.is_known_class("")

    def test_lists_subtypes_in_authored_order_and_skips_properties(self) -> None:
        node: dict[str, Any] = {"loco": {}, "width_mm": 3, "freight": {}}
        assert [name for name, _ in r49.vocabulary_subtypes(node)] == ["loco", "freight"]

    def test_segment_prefix_never_matches_inside_a_segment(self) -> None:
        assert r49.is_segment_prefix("stock", "stock")
        assert r49.is_segment_prefix("stock", "stock.loco")
        assert not r49.is_segment_prefix("stock", "stockyard")
