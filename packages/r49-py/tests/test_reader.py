"""The reader beyond what a conformance case asserts: loading from a path, a
folder or a URL, the bytes it hands back, the image mismatches in order, the
whole fit result and the vocabulary questions."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tracemalloc
import urllib.error
import zipfile
from pathlib import Path
from typing import Any

import pytest
from http_server import served

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


def zipped(files: dict[str, bytes], compression: int = zipfile.ZIP_STORED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as zf:
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
        assert layout.tracks == []
        assert "tracks" not in layout.model_fields_set

    def test_reads_track_nodes_in_order(self) -> None:
        track = {"nodes": [{"x": 2, "y": 3, "heading": 0.5}, {"x": 0, "y": 1, "heading": -3}]}
        data = {
            "version": 4,
            "layout": {"scale": "HO", "tracks": [track]},
            "camera": {"resolution": {"width": 4, "height": 3}},
        }
        layout = r49.parse_manifest(json.dumps(data).encode()).layout
        nodes = [
            r49.TrackNode(x=2, y=3, heading=0.5),
            r49.TrackNode(x=0, y=1, heading=-3),
        ]
        assert layout.tracks == [r49.Track(nodes=nodes)]
        assert layout.tracks[0].clicks == []

    def test_reads_track_clicks_in_order_with_their_straight_marks(self) -> None:
        nodes = [{"x": 0, "y": 0, "heading": 0}, {"x": 9, "y": 0, "heading": 0}]
        clicks = [{"x": 0, "y": 0, "straight": True}, {"x": 9, "y": 0.5}, {"x": 4, "y": -0.5}]
        data = {
            "version": 4,
            "layout": {"scale": "HO", "tracks": [{"nodes": nodes, "clicks": clicks}]},
            "camera": {"resolution": {"width": 4, "height": 3}},
        }
        layout = r49.parse_manifest(json.dumps(data).encode()).layout
        assert layout.tracks[0].clicks == [
            r49.Click(x=0, y=0, straight=True),
            r49.Click(x=9, y=0.5),
            r49.Click(x=4, y=-0.5),
        ]

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


def layout_manifest(*filenames: str) -> bytes:
    return json.dumps(
        {
            "version": 4,
            "layout": {"scale": "N"},
            "camera": {"resolution": {"width": 4, "height": 3}},
            "images": [{"filename": name} for name in filenames],
        }
    ).encode()


def folder(root: Path, files: dict[str, bytes]) -> Path:
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


def damaged(data: bytes, name: str, at: int = 0) -> bytes:
    """A zip with four stored bytes of ``name`` changed, ``at`` bytes into it, its
    directory intact."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        info = zf.getinfo(name)
    start = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra) + at
    return data[:start] + bytes(b ^ 0xFF for b in data[start : start + 4]) + data[start + 4 :]


LZMA_HEADER = 9
"""What ``zipfile`` writes before an lzma stream. Damage past it reaches the
decompressor; damage to its size field only looks like a short entry."""


class TestZip:
    def test_opens_a_zip_larger_than_the_images_it_reads(self, tmp_path: Path) -> None:
        size = 8 * 1024 * 1024
        path = tmp_path / "large.r49"
        path.write_bytes(
            zipped(
                {
                    "manifest.json": layout_manifest("small.jpg", "large.jpg"),
                    "small.jpg": JPEG,
                    "large.jpg": os.urandom(size),
                }
            )
        )
        tracemalloc.start()
        try:
            archive = r49.load(path)
            image = archive.image("small.jpg")
            mismatches = archive.image_mismatches()
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        assert image == JPEG
        assert mismatches == []
        assert peak < size / 4

    def test_inflates_only_the_file_asked_for(self) -> None:
        data = zipped(
            {
                "manifest.json": layout_manifest("good.jpg", "bad.jpg"),
                "good.jpg": JPEG,
                "bad.jpg": JPEG * 100,
            }
        )
        archive = r49.load(damaged(data, "bad.jpg"))
        assert archive.image("good.jpg") == JPEG

    def test_refuses_a_damaged_image_when_it_is_read(self, tmp_path: Path) -> None:
        data = damaged(
            zipped({"manifest.json": layout_manifest("bad.jpg"), "bad.jpg": JPEG * 100}), "bad.jpg"
        )
        path = tmp_path / "damaged.r49"
        path.write_bytes(data)
        for source in (data, path):
            archive = r49.load(source)
            with pytest.raises(r49.R49Error) as refused:
                archive.image("bad.jpg")
            assert refused.value.rule == "archive/not-zip"

    @pytest.mark.parametrize(
        ("compression", "at"),
        [
            (zipfile.ZIP_STORED, 0),
            (zipfile.ZIP_DEFLATED, 0),
            (zipfile.ZIP_BZIP2, 0),
            (zipfile.ZIP_LZMA, LZMA_HEADER),
        ],
    )
    def test_refuses_a_damaged_image_however_it_is_compressed(
        self, compression: int, at: int, tmp_path: Path
    ) -> None:
        files = {"manifest.json": layout_manifest("bad.jpg"), "bad.jpg": bytes(range(256)) * 4}
        data = damaged(zipped(files, compression), "bad.jpg", at)
        path = tmp_path / "damaged.r49"
        path.write_bytes(data)
        for source in (data, path):
            archive = r49.load(source)
            with pytest.raises(r49.R49Error) as refused:
                archive.image("bad.jpg")
            assert refused.value.rule == "archive/not-zip"

    @pytest.mark.parametrize(
        "compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_LZMA]
    )
    def test_a_disk_error_reading_an_image_is_no_verdict_on_the_archive(
        self, compression: int, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        archive = self.loaded_with_a_failing_disk(compression, tmp_path, monkeypatch)
        with pytest.raises(OSError):
            archive.image("a.jpg")

    def test_an_oserror_reading_a_bz2_image_counts_as_damage(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        archive = self.loaded_with_a_failing_disk(zipfile.ZIP_BZIP2, tmp_path, monkeypatch)
        with pytest.raises(r49.R49Error) as refused:
            archive.image("a.jpg")
        assert refused.value.rule == "archive/not-zip"

    @staticmethod
    def loaded_with_a_failing_disk(
        compression: int, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> r49.R49Archive:
        path = tmp_path / "layout.r49"
        path.write_bytes(
            zipped({"manifest.json": layout_manifest("a.jpg"), "a.jpg": JPEG}, compression)
        )
        archive = r49.load(path)

        def fail(*_: object) -> bytes:
            raise OSError("disk error")

        monkeypatch.setattr(zipfile.ZipExtFile, "read", fail)
        return archive

    @pytest.mark.parametrize("module", ["bz2", "lzma"])
    def test_imports_on_a_python_built_without_an_optional_module(self, module: str) -> None:
        code = f"import sys; sys.modules[{module!r}] = None; import r49"
        subprocess.run([sys.executable, "-c", code], check=True, capture_output=True)

    def test_refuses_a_damaged_manifest_on_load(self) -> None:
        data = damaged(zipped({"manifest.json": layout_manifest()}), "manifest.json")
        with pytest.raises(r49.R49Error) as refused:
            r49.load(data)
        assert refused.value.rule == "archive/not-zip"

    def test_refuses_an_encrypted_image_on_load(self) -> None:
        data = bytearray(zipped({"manifest.json": layout_manifest("a.jpg"), "a.jpg": JPEG}))
        # The central directory's general purpose flags for the second entry.
        first = data.index(b"PK\x01\x02")
        data[data.index(b"PK\x01\x02", first + 4) + 8] |= 1
        with pytest.raises(r49.R49Error) as refused:
            r49.load(bytes(data))
        assert refused.value.rule == "archive/not-zip"

    def test_refuses_an_empty_file_at_a_path(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.r49"
        path.write_bytes(b"")
        with pytest.raises(r49.R49Error) as refused:
            r49.load(path)
        assert refused.value.rule == "archive/empty"

    def test_ignores_nothing_so_a_dot_file_is_an_orphan(self) -> None:
        archive = r49.load(zipped({"manifest.json": layout_manifest(), ".DS_Store": b"x"}))
        assert archive.image_mismatches() == [r49.ImageMismatch("images/orphan", ".DS_Store")]
        assert archive.image(".DS_Store") == b"x"

    def test_a_name_that_leaves_the_archive_is_absent_even_if_the_zip_holds_it(self) -> None:
        archive = r49.load(zipped({"manifest.json": layout_manifest(), "../x": JPEG, "/y": JPEG}))
        assert archive.image("../x") is None
        assert archive.image("/y") is None
        assert archive.image("shots/../../x") is None


class TestFolder:
    FILES = {
        "manifest.json": layout_manifest("shots/a.jpg"),
        "shots/a.jpg": JPEG,
        "shots/.DS_Store": b"x",
        ".DS_Store": b"x",
        ".hidden/notes.txt": b"x",
    }

    def test_reads_a_directory_given_as_a_path_or_a_string(self, tmp_path: Path) -> None:
        root = folder(tmp_path / "layout.r49", self.FILES)
        for source in (root, str(root)):
            archive = r49.load(source)
            assert archive.image("shots/a.jpg") == JPEG
            assert archive.image("absent.jpg") is None

    def test_lists_files_and_ignores_every_dot_path(self, tmp_path: Path) -> None:
        archive = r49.load(folder(tmp_path / "layout.r49", self.FILES))
        assert archive.entries() == ["manifest.json", "shots/a.jpg"]
        assert archive.image_mismatches() == []

    def test_reads_no_file_under_a_dot_path(self, tmp_path: Path) -> None:
        archive = r49.load(folder(tmp_path / "layout.r49", self.FILES))
        assert archive.image(".DS_Store") is None
        assert archive.image("shots/.DS_Store") is None
        assert archive.image(".hidden/notes.txt") is None
        assert archive.image("./shots/a.jpg") is None

    def test_a_name_that_leaves_the_archive_is_absent(self, tmp_path: Path) -> None:
        (tmp_path / "x").write_bytes(JPEG)
        archive = r49.load(folder(tmp_path / "layout.r49", self.FILES))
        assert archive.image("../x") is None
        assert archive.image(str(tmp_path / "x")) is None

    def test_a_directory_or_a_path_through_a_file_is_absent(self, tmp_path: Path) -> None:
        archive = r49.load(folder(tmp_path / "layout.r49", self.FILES))
        assert archive.image("shots") is None
        assert archive.image("shots/") is None
        assert archive.image("") is None
        assert archive.image("shots/a.jpg/x") is None
        assert archive.image("shots//a.jpg") is None

    def test_a_manifest_naming_a_dot_path_reports_it_missing(self, tmp_path: Path) -> None:
        files = {"manifest.json": layout_manifest(".a.jpg"), ".a.jpg": JPEG}
        archive = r49.load(folder(tmp_path / "layout.r49", files))
        assert archive.image_mismatches() == [r49.ImageMismatch("images/missing", ".a.jpg")]

    def test_refuses_a_folder_with_no_manifest(self, tmp_path: Path) -> None:
        with pytest.raises(r49.R49Error) as refused:
            r49.load(folder(tmp_path / "layout.r49", {"a.jpg": JPEG}))
        assert refused.value.rule == "archive/no-manifest"


class TestUrl:
    def test_reads_a_base_with_or_without_a_trailing_slash(self, tmp_path: Path) -> None:
        root = folder(tmp_path, {"manifest.json": layout_manifest("a.jpg"), "a.jpg": JPEG})
        with served(root) as base:
            for source in (base, f"{base}/"):
                assert r49.load(source).image("a.jpg") == JPEG

    def test_reads_a_base_below_the_root_of_the_server(self, tmp_path: Path) -> None:
        folder(tmp_path / "x/layout.r49", {"manifest.json": layout_manifest(), "a.jpg": JPEG})
        with served(tmp_path) as base:
            assert r49.load(f"{base}/x/layout.r49").image("a.jpg") == JPEG

    def test_encodes_each_path_segment(self, tmp_path: Path) -> None:
        name = "my shots/a #1?100%é.jpg"
        root = folder(tmp_path, {"manifest.json": layout_manifest(name), name: JPEG})
        with served(root) as base:
            assert r49.load(base).image(name) == JPEG

    def test_a_404_is_an_absent_file(self, tmp_path: Path) -> None:
        with served(folder(tmp_path, {"manifest.json": layout_manifest()})) as base:
            assert r49.load(base).image("absent.jpg") is None

    def test_no_manifest_is_refused(self, tmp_path: Path) -> None:
        with served(folder(tmp_path, {"a.jpg": JPEG})) as base:
            with pytest.raises(r49.R49Error) as refused:
                r49.load(base)
        assert refused.value.rule == "archive/no-manifest"

    def test_a_500_is_no_verdict_on_the_archive(self, tmp_path: Path) -> None:
        root = folder(tmp_path, {"manifest.json": layout_manifest("a.jpg"), "a.jpg": JPEG})
        with served(root, "a.jpg") as base:
            archive = r49.load(base)
            with pytest.raises(urllib.error.HTTPError):
                archive.image("a.jpg")
        with served(root, "manifest.json") as base:
            with pytest.raises(urllib.error.HTTPError):
                r49.load(base)

    def test_a_network_failure_is_no_verdict_on_the_archive(self, tmp_path: Path) -> None:
        with served(tmp_path) as base:
            pass
        with pytest.raises(OSError):
            r49.load(base)

    def test_a_name_that_leaves_the_archive_is_absent(self, tmp_path: Path) -> None:
        folder(tmp_path / "layout.r49", {"manifest.json": layout_manifest()})
        (tmp_path / "x").write_bytes(JPEG)
        with served(tmp_path) as base:
            archive = r49.load(f"{base}/layout.r49")
            assert archive.image("../x") is None
            assert archive.image("/x") is None

    def test_a_name_with_no_file_at_its_path_is_absent(self, tmp_path: Path) -> None:
        with served(folder(tmp_path, {"manifest.json": layout_manifest()})) as base:
            archive = r49.load(base)
            assert archive.image("") is None
            assert archive.image("./manifest.json") is None
            assert archive.image("shots/") is None

    def test_a_dot_path_is_absent_with_no_request(self, tmp_path: Path) -> None:
        files = {
            "manifest.json": layout_manifest(".a.jpg"),
            ".a.jpg": JPEG,
            ".git/config": JPEG,
            "shots/.DS_Store": JPEG,
        }
        requests: list[str] = []
        with served(folder(tmp_path, files), requests=requests) as base:
            archive = r49.load(base)
            requests.clear()
            assert archive.image(".git/config") is None
            assert archive.image("shots/.DS_Store") is None
            assert archive.image(".a.jpg") is None
        assert requests == []

    def test_a_manifest_naming_a_dot_path_still_loads(self, tmp_path: Path) -> None:
        with served(folder(tmp_path, {"manifest.json": layout_manifest(".a.jpg")})) as base:
            assert r49.load(base).manifest.images[0].filename == ".a.jpg"

    def test_lists_the_names_in_the_manifest_and_reports_no_mismatch(self, tmp_path: Path) -> None:
        files = {"manifest.json": layout_manifest("a.jpg", "gone.jpg"), "a.jpg": JPEG, "b": JPEG}
        with served(folder(tmp_path, files)) as base:
            archive = r49.load(base)
            assert archive.entries() == ["manifest.json", "a.jpg", "gone.jpg"]
            assert archive.image_mismatches() == []


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
