"""Every conformance case, against this package's public interface."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import pytest

import r49

# The installed-package check points this at a checkout's conformance/.
CASES = Path(os.environ.get("R49_CONFORMANCE", Path(__file__).parents[2] / "conformance"))


def _cases() -> list[Path]:
    return sorted(p for p in CASES.iterdir() if (p / "expected.json").is_file())


def _load(case: Path) -> r49.Manifest:
    archive = case / "archive.r49"
    if archive.exists():
        return r49.load(archive).manifest
    return r49.manifest_from_json((case / "manifest.json").read_bytes())


def _close(actual: float | None, expected: float | None, tolerance: float) -> bool:
    if actual is None or expected is None:
        return actual is expected
    return math.isclose(actual, expected, rel_tol=0, abs_tol=tolerance)


def test_there_are_cases() -> None:
    assert len(_cases()) > 1


@pytest.mark.parametrize("case", _cases(), ids=lambda p: p.name)
def test_case(case: Path) -> None:
    expected: dict[str, Any] = json.loads((case / "expected.json").read_text("utf-8"))

    if not expected["accept"]:
        with pytest.raises(r49.FormatError) as refused:
            _load(case)
        assert refused.value.rule == expected["rule"]
        assert refused.value.rule in r49.RULES
        return

    manifest = _load(case)
    if "id" in expected:
        assert manifest.id == expected["id"]
    if "fit" in expected:
        want = expected["fit"]
        fit = r49.calibration_fit(manifest)
        tolerance = want["tolerance"]
        assert _close(fit.dpt, want["dpt"], tolerance), (fit.dpt, want["dpt"])
        assert _close(fit.residual, want["residual"], tolerance), (fit.residual, want["residual"])
        assert [[p.a, p.b] for p in fit.pairs] == want["pairs"]
        assert [{"point": p.point, "reason": p.reason} for p in fit.left_out] == want["left_out"]
        assert fit.camera_height_fits == want["camera_height_fits"]
