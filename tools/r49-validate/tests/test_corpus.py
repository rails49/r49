from __future__ import annotations

from r49_validate.corpus import check_path, handle_of, scope_of


def codes(path: str, author: str | None) -> list[str]:
    return [f.code for f in check_path(path, author)]


def test_recognises_a_submission_and_a_fixture() -> None:
    assert scope_of("archives/alice/west-yard.r49") == "archives"
    assert scope_of("fixtures/cars-0-10.r49") == "fixtures"


def test_refuses_depths_the_layout_does_not_define() -> None:
    for path in [
        "archives/west-yard.r49",
        "archives/alice/yard/west.r49",
        "fixtures/old/cars.r49",
        "west-yard.r49",
    ]:
        assert scope_of(path) == "unknown", path


def test_names_the_contributor_directory_only_for_a_submission() -> None:
    assert handle_of("archives/alice/west-yard.r49") == "alice"
    assert handle_of("fixtures/cars-0-10.r49") is None


def test_accepts_a_well_formed_submission_from_its_own_author() -> None:
    assert codes("archives/alice/west-yard.r49", "alice") == []


def test_rejects_a_filename_that_is_not_a_slug() -> None:
    for name in ["cars 0-10.r49", "West_Yard.r49", "-west.r49", "west--yard.r49"]:
        assert codes(f"archives/alice/{name}", "alice") == ["path/slug"], name


def test_rejects_a_submission_under_somebody_elses_handle() -> None:
    findings = check_path("archives/bob/west-yard.r49", "alice")
    assert [f.code for f in findings] == ["path/owner"]
    assert "archives/alice/" in findings[0].message


def test_skips_only_the_ownership_rule_when_the_author_is_unknown() -> None:
    assert codes("archives/bob/west-yard.r49", None) == []
    assert codes("archives/bob/cars 0-10.r49", None) == ["path/slug"]


def test_does_not_apply_the_ownership_rule_to_fixtures() -> None:
    assert codes("fixtures/cars-0-10.r49", "alice") == []


def test_reports_one_shape_error_for_a_path_with_no_place() -> None:
    assert codes("west-yard.r49", "alice") == ["path/shape"]


def test_tolerates_backslashes() -> None:
    assert codes("archives\\alice\\west-yard.r49", "alice") == []
