"""Python-side behaviour the conformance cases do not reach."""

from __future__ import annotations

from pathlib import Path

import pytest

import r49

ROOT = Path(__file__).parents[2]
FROZEN = ROOT / "conformance" / "format-v4" / "archive.r49"


def test_loads_from_bytes_and_from_a_path() -> None:
    by_path = r49.load(FROZEN)
    by_bytes = r49.load(FROZEN.read_bytes())
    assert by_path.manifest == by_bytes.manifest


def test_yields_image_bytes_and_lists_entries() -> None:
    archive = r49.load(FROZEN)
    image = archive.image("frame.jpg")
    assert image is not None and image[:2] == b"\xff\xd8"
    assert archive.image("absent.jpg") is None
    assert sorted(archive.entries()) == ["frame.jpg", "manifest.json"]


def test_reads_both_provenance_arms() -> None:
    labels = r49.load(FROZEN).manifest.images[0].labels
    human, corrected = labels
    assert isinstance(human, r49.HumanLabel)
    assert isinstance(corrected, r49.CorrectedLabel)
    assert corrected.proposed_by == "fixture-model-v1"
    assert human.class_ == "stock.freight"


@pytest.mark.parametrize("fixture", sorted((ROOT / "fixtures").glob("*.r49")), ids=lambda p: p.name)
def test_every_fixture_loads(fixture: Path) -> None:
    fit = r49.calibration_fit(r49.load(fixture).manifest)
    assert fit.dpt is not None
    assert fit.camera_height_fits is True


def test_an_unknown_key_says_a_newer_version_may_exist() -> None:
    with pytest.raises(r49.FormatError) as refused:
        r49.manifest_from_json(
            '{"version": 4, "layout": {"scale": "HO", "calibration": {"focal_length_mm": 24}},'
            ' "camera": {"resolution": {"width": 1, "height": 1}}}'
        )
    assert refused.value.rule == "format/unknown-key"
    assert "layout.calibration.focal_length_mm" in str(refused.value)
    assert "newer version" in str(refused.value)


def test_the_data_file_is_what_the_package_reads() -> None:
    assert r49.STANDARD_GAUGE == 1435.0
    assert r49.SCALES == ("G", "O", "S", "HO", "T", "N", "Z")
    assert r49.SCALE_TO_RATIO["HO"] == 87
    assert r49.gauge_mm("N") == 1435 / 160
    assert r49.RECOMMENDED_DPT == 20
    assert r49.MANIFEST_VERSION == 4


def test_the_vocabulary_is_read_only() -> None:
    with pytest.raises(TypeError):
        r49.VOCABULARY["stock"] = {}  # type: ignore[index]
