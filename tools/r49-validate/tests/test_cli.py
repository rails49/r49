"""The validator's seam: JSON on stdout, a human report on stderr, and the exit code."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from r49_validate.cli import run

from .build import build, car

ROOT = Path(__file__).parents[3]


def write(tmp: Path, rel: str, data: bytes) -> str:
    path = tmp / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel


@pytest.fixture(autouse=True)
def in_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)


def test_exit_0_with_a_json_report_for_a_clean_archive(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rel = write(tmp_path, "archives/alice/west-yard.r49", build(labels=[car()]))
    assert run(["--author", "alice", "--", rel]) == 0
    out, err = capsys.readouterr()
    report = json.loads(out)
    assert report["version"] == 1 and report["ok"] is True
    assert report["archives"][0]["path"] == rel
    assert set(report["archives"][0]) >= {"dpt", "dptResidual", "cameraHeightMM", "errors"}
    assert "✅" in err


def test_exit_0_with_warnings(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rel = write(tmp_path, "archives/alice/west-yard.r49", build(complete=False))
    assert run([rel]) == 0
    assert json.loads(capsys.readouterr().out)["archives"][0]["warnings"]


def test_exit_1_on_a_blocking_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rel = write(tmp_path, "archives/alice/west-yard.r49", build(archive_id=None))
    assert run([rel]) == 1
    assert json.loads(capsys.readouterr().out)["ok"] is False


def test_reads_committed_siblings_for_the_id_collision_check(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write(tmp_path, "archives/alice/old.r49", build(archive_id="sameIdHere"))
    rel = write(tmp_path, "archives/alice/new.r49", build(archive_id="sameIdHere"))
    assert run([rel]) == 1
    codes = [e["code"] for e in json.loads(capsys.readouterr().out)["archives"][0]["errors"]]
    assert codes == ["archive/id-collision"]


def test_exit_2_with_no_paths() -> None:
    assert run([]) == 2


def test_guidance_prints_the_table(capsys: pytest.CaptureFixture[str]) -> None:
    assert run(["guidance"]) == 0
    assert "Recommended DPT" in capsys.readouterr().out


def test_the_committed_contributing_md_is_current(capsys: pytest.CaptureFixture[str]) -> None:
    assert run(["guidance", "--check", str(ROOT / "CONTRIBUTING.md")]) == 0
    out, err = capsys.readouterr()
    assert out == ""
    assert "up to date" in err


def test_every_committed_archive_passes(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = sorted(str(p.relative_to(ROOT)) for p in ROOT.glob("fixtures/*.r49"))
    paths += sorted(str(p.relative_to(ROOT)) for p in ROOT.glob("archives/*/*.r49"))
    monkeypatch.chdir(ROOT)
    assert run(paths) == 0
    capsys.readouterr()
