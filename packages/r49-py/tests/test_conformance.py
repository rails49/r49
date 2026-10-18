"""Every case in ``conformance/cases/``, run through this package.

Cases assert an outcome (accept or reject, the rule id, DPT, residual and
image mismatches) and never a message: the id is the contract, the wording is not.
``conformance/README.md`` defines a case; this is the Python way of running one.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

import r49

CASES = Path(__file__).resolve().parents[3] / "conformance" / "cases"


@dataclass(frozen=True)
class Outcome:
    """What this package made of a case's input."""

    result: str
    rule: str | None = None
    dpt: float | None = None
    residual: float | None = None
    image_mismatches: tuple[r49.ImageMismatch, ...] = ()


def judge(case: Path) -> Outcome:
    """Run a case's input through the package. A refusal is an R49Error;
    anything else raised is a bug, not a verdict, and propagates."""
    archive = case / "archive.r49"
    manifest = case / "manifest.json"
    inputs = [path for path in (archive, manifest) if path.exists()]
    assert len(inputs) == 1, f"{case.name} holds {len(inputs)} of archive.r49 and manifest.json"
    mismatches: tuple[r49.ImageMismatch, ...] = ()
    try:
        if archive.exists():
            loaded = r49.load(archive)
            parsed, mismatches = loaded.manifest, tuple(loaded.image_mismatches())
        else:
            # Python parses a bare manifest on its own, so it is exempt from
            # the zip and image rules without a placeholder archive.
            parsed = r49.parse_manifest(manifest.read_bytes())
    except r49.R49Error as err:
        return Outcome("reject", rule=err.rule)
    result = r49.fit(parsed)
    return Outcome("accept", dpt=result.dpt, residual=result.residual, image_mismatches=mismatches)


def disagreements(expected: dict[str, Any], outcome: Outcome) -> list[str]:
    """Where ``outcome`` disagrees with ``expected``, one line each."""
    if expected["result"] != outcome.result:
        got = f"reject ({outcome.rule})" if outcome.result == "reject" else "accept"
        return [f"expected {expected['result']}, got {got}"]
    if outcome.result == "reject":
        rule = expected["rule"]
        return [] if rule == outcome.rule else [f"expected rule {rule}, got {outcome.rule}"]

    found: list[str] = []
    for key, got in (("dpt", outcome.dpt), ("residual", outcome.residual)):
        if key not in expected:
            continue
        want = expected[key]
        if want is None or got is None:
            if want != got:
                found.append(f"expected {key} {want}, got {got}")
        elif "tolerance" not in expected:
            found.append(f"{key} is a number, so expected.json needs a tolerance")
        elif not math.fabs(got - want) <= expected["tolerance"]:
            found.append(f"expected {key} {want} ± {expected['tolerance']}, got {got}")

    # In any order; absent, there are none.
    want = sorted((m["rule"], m["filename"]) for m in expected.get("image_mismatches", []))
    got = sorted((m.rule, m.filename) for m in outcome.image_mismatches)
    if want != got:
        found.append(f"expected image mismatches {want}, got {got}")
    return found


def expected_of(case: Path) -> dict[str, Any]:
    return json.loads((case / "expected.json").read_text(encoding="utf-8"))


ALL = sorted(path for path in CASES.iterdir() if path.is_dir())


@pytest.mark.parametrize("case", ALL, ids=[path.name for path in ALL])
def test_case(case: Path) -> None:
    assert disagreements(expected_of(case), judge(case)) == []


REJECTED = {expected_of(c)["rule"] for c in ALL if expected_of(c)["result"] == "reject"}
REPORTED = {m["rule"] for c in ALL for m in expected_of(c).get("image_mismatches", [])}
IMAGE_RULES = [rule for rule in r49.FORMAT_RULES if rule.startswith("images/")]


def test_every_format_rule_id_but_the_image_rules_is_rejected_at_least_once() -> None:
    missing = [r for r in r49.FORMAT_RULES if r not in IMAGE_RULES and r not in REJECTED]
    assert missing == []


def test_each_image_rule_is_reported_at_least_once_and_never_rejected() -> None:
    assert [rule for rule in IMAGE_RULES if rule not in REPORTED] == []
    assert [rule for rule in IMAGE_RULES if rule in REJECTED] == []


def test_cases_name_only_format_rule_ids() -> None:
    assert (REJECTED | REPORTED) - set(r49.FORMAT_RULES) == set()
