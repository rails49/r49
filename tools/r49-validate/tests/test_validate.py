from __future__ import annotations

import r49

from r49_validate.report import ArchiveReport, Finding
from r49_validate.validate import ArchiveInput, validate

from .build import CALIBRATED, build, car

PATH = "archives/alice/west-yard.r49"


def report_for(data: bytes, path: str = PATH, author: str | None = "alice") -> ArchiveReport:
    return validate([ArchiveInput(path, data)], author=author).archives[0]


def codes(findings: tuple[Finding, ...]) -> list[str]:
    return [f.code for f in findings]


class TestTheBlockingBarUnderArchives:
    def test_passes_a_well_formed_submission_with_no_findings(self) -> None:
        result = report_for(build(labels=[car()]))
        assert result.errors == ()
        assert result.warnings == ()
        assert result.scope == "archives"

    def test_reports_bytes_that_are_not_an_archive_as_one_load_failure(self) -> None:
        result = report_for(bytes([1, 2, 3, 4]))
        assert codes(result.errors) == ["archive/load"]
        assert "format/zip" in result.errors[0].message
        # The facts are unknown, not zero — a row still exists for the file.
        assert result.images is None
        assert result.id is None

    def test_blocks_a_manifest_naming_an_image_the_archive_lacks(self) -> None:
        assert "images/missing" in codes(report_for(build(missing_image=True)).errors)

    def test_blocks_an_image_nobody_references(self) -> None:
        assert "images/orphan" in codes(report_for(build(extra_entry="stray.jpg")).errors)

    def test_blocks_an_untouched_proposal_and_accepts_a_corrected_one(self) -> None:
        proposed = report_for(build(labels=[car(provenance="proposed", proposed_by="v1.0.0")]))
        assert "labels/provenance" in codes(proposed.errors)
        corrected = report_for(build(labels=[car(provenance="corrected", proposed_by="v1.0.0")]))
        assert corrected.errors == ()

    def test_blocks_a_class_outside_the_vocabulary_segment_by_segment(self) -> None:
        unknown = report_for(build(labels=[car(**{"class": "stockyard"})]))
        assert "labels/class" in codes(unknown.errors)
        nested = report_for(build(labels=[car(**{"class": "stock.loco.steam"})]))
        assert nested.errors == ()

    def test_blocks_an_archive_with_no_id(self) -> None:
        result = report_for(build(archive_id=None))
        assert codes(result.errors) == ["archive/id"]
        assert result.id is None
        assert result.warnings == ()

    def test_blocks_two_archives_in_one_directory_sharing_an_id(self) -> None:
        report = validate(
            [
                ArchiveInput("archives/alice/west-yard.r49", build(archive_id="sameIdHere")),
                ArchiveInput("archives/alice/east-yard.r49", build(archive_id="sameIdHere")),
            ],
            author="alice",
        )
        assert codes(report.archives[0].errors) == []
        assert "archive/id-collision" in codes(report.archives[1].errors)
        assert not report.ok

    def test_blocks_a_collision_with_a_committed_sibling(self) -> None:
        report = validate(
            [ArchiveInput("archives/alice/west-yard.r49", build(archive_id="sameIdHere"))],
            author="alice",
            siblings=[ArchiveInput("archives/alice/old.r49", build(archive_id="sameIdHere"))],
        )
        assert "archive/id-collision" in codes(report.archives[0].errors)

    def test_leaves_the_same_id_in_two_directories_alone(self) -> None:
        report = validate(
            [
                ArchiveInput("archives/alice/west-yard.r49", build(archive_id="sameIdHere")),
                ArchiveInput("archives/bob/west-yard.r49", build(archive_id="sameIdHere")),
            ],
        )
        assert report.ok


class TestWarningsWhichNeverBlock:
    def test_warns_below_the_recommended_dpt_without_failing(self) -> None:
        # 10 px over 800 mm at HO is far below the recommended DPT.
        coarse = [
            {"px": {"x": 0, "y": 0}, "world": {"x": 0, "y": 0, "z": 0}},
            {"px": {"x": 10, "y": 0}, "world": {"x": 800, "y": 0, "z": 0}},
        ]
        report = validate([ArchiveInput(PATH, build(calibration=coarse, labels=[car()]))], "alice")
        result = report.archives[0]
        assert "calibration/dpt" in codes(result.warnings)
        assert result.dpt is not None and result.dpt < r49.RECOMMENDED_DPT
        assert report.ok

    def test_compares_against_the_recommended_dpt_from_the_data_file(self) -> None:
        # Just above and just below the data file's number, whatever it is.
        def at(dpt: float) -> list[dict[str, object]]:
            px = dpt / r49.gauge_mm("HO") * 800
            return [CALIBRATED[0], {"px": {"x": px, "y": 0}, "world": {"x": 800, "y": 0, "z": 0}}]

        above = report_for(build(calibration=at(r49.RECOMMENDED_DPT * 1.01)))
        below = report_for(build(calibration=at(r49.RECOMMENDED_DPT * 0.99)))
        assert "calibration/dpt" not in codes(above.warnings)
        assert "calibration/dpt" in codes(below.warnings)

    def test_warns_when_calibration_does_not_resolve(self) -> None:
        result = report_for(build(calibration=[], labels=[car()]))
        assert "calibration/unresolved" in codes(result.warnings)
        assert result.dpt is None
        assert result.errors == ()

    def test_warns_about_points_left_off_the_reference_plane(self) -> None:
        points = [*CALIBRATED, {"px": {"x": 5, "y": 5}, "world": {"x": 1, "y": 1, "z": 85}}]
        result = report_for(build(calibration=points))
        assert "calibration/off-reference-plane" in codes(result.warnings)
        silenced = report_for(build(calibration=points, camera_height_mm=1150))
        assert "calibration/off-reference-plane" not in codes(silenced.warnings)

    def test_warns_about_incomplete_images(self) -> None:
        result = report_for(build(complete=False, images=3))
        assert "images/incomplete" in codes(result.warnings)
        assert result.incomplete == 3

    def test_says_nothing_about_a_complete_image_with_zero_labels(self) -> None:
        result = report_for(build(labels=[], complete=True))
        assert result.warnings == ()
        assert result.labels == 0


class TestFixturesGetAThinnerBar:
    def test_holds_a_fixture_to_structure_only_with_no_warnings(self) -> None:
        result = report_for(
            build(archive_id=None, calibration=[], complete=False),
            path="fixtures/cars-0-10.r49",
        )
        assert result.errors == ()
        assert result.warnings == ()
        assert result.scope == "fixtures"

    def test_still_requires_a_fixture_to_name_its_images(self) -> None:
        result = report_for(
            build(archive_id=None, extra_entry="stray.jpg"), path="fixtures/cars-0-10.r49"
        )
        assert "images/orphan" in codes(result.errors)


def test_reports_the_facts_the_summary_table_renders() -> None:
    result = report_for(build(images=2, complete=False, labels=[car(), car(id="car-2")]))
    assert (result.images, result.labels, result.complete, result.incomplete) == (2, 2, 0, 2)
    assert result.id == "aBcDeFgHiJk"
    # Two points make exactly one pair, which reproduces itself: no residual.
    assert result.dpt_residual is None
