"""Every case in ``conformance/cases/``, run through this package.

Cases assert an outcome (accept or reject, the rule id, DPT, residual and
image mismatches) and never a message: the id is the contract, the wording is not.
A case whose input is ``track.json`` asserts points on the curve between nodes
and the nearest point on a track instead.
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
    result = r49.calibration_fit(parsed)
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

    # Order does not matter. A missing key means no mismatches.
    want = sorted((m["rule"], m["filename"]) for m in expected.get("image_mismatches", []))
    got = sorted((m.rule, m.filename) for m in outcome.image_mismatches)
    if want != got:
        found.append(f"expected image mismatches {want}, got {got}")
    return found


def track_disagreements(expected: dict[str, Any], tracks: list[r49.Track]) -> list[str]:
    """Where this package's curve through ``tracks`` disagrees with a track
    case's ``expected``, one line each. Each coordinate and distance must be
    within ``tolerance``; each heading must be in (−π, π] and within
    ``tolerance`` of the expected direction, modulo 2π."""
    tolerance = expected["tolerance"]
    found: list[str] = []

    def near(what: str, got: float, want: float) -> None:
        if not math.fabs(got - want) <= tolerance:
            found.append(f"{what}: expected {want} ± {tolerance}, got {got}")

    def heading(what: str, got: float, want: float) -> None:
        if not -math.pi < got <= math.pi:
            found.append(f"{what}: heading {got} is outside (−π, π]")
        elif not math.fabs(r49.wrap_angle(got - want)) <= tolerance:
            found.append(f"{what}: expected heading {want} ± {tolerance}, got {got}")

    for p in expected["points"]:
        what = f"track {p['track']} segment {p['segment']} t {p['t']}"
        track: int = p["track"]
        i: int = p["segment"]
        nodes = tracks[track].nodes
        s = r49.segment(nodes[i], nodes[i + 1])
        at = r49.point_at(s, p["t"])
        near(f"{what} x", at.x, p["x"])
        near(f"{what} y", at.y, p["y"])
        heading(what, r49.heading_at(s, p["t"]), p["heading"])
    for n in expected["nearest"]:
        what = f"nearest ({n['at']['x']}, {n['at']['y']})"
        got = r49.nearest_on_track(tracks, r49.Point.model_validate(n["at"]))
        if got is None:
            found.append(f"{what}: expected a point, got None")
            continue
        if got.track != n["track"]:
            found.append(f"{what}: expected track {n['track']}, got {got.track}")
        near(f"{what} x", got.point.x, n["x"])
        near(f"{what} y", got.point.y, n["y"])
        near(f"{what} distance", got.distance, n["distance"])
        heading(what, got.heading, n["heading"])
    return found


def expected_of(case: Path) -> dict[str, Any]:
    return json.loads((case / "expected.json").read_text(encoding="utf-8"))


def tracks_of(case: Path) -> list[r49.Track]:
    data = json.loads((case / "track.json").read_text(encoding="utf-8"))
    return [r49.Track.model_validate(track) for track in data["tracks"]]


ALL = sorted(path for path in CASES.iterdir() if path.is_dir())
TRACK = [c for c in ALL if (c / "track.json").exists()]
VERDICT = [c for c in ALL if c not in TRACK]


def test_every_case_holds_one_input() -> None:
    inputs = ("archive.r49", "manifest.json", "track.json")
    assert [c.name for c in ALL if sum((c / name).exists() for name in inputs) != 1] == []


@pytest.mark.parametrize("case", VERDICT, ids=[path.name for path in VERDICT])
def test_case(case: Path) -> None:
    assert disagreements(expected_of(case), judge(case)) == []


@pytest.mark.parametrize("case", TRACK, ids=[path.name for path in TRACK])
def test_track_case(case: Path) -> None:
    assert track_disagreements(expected_of(case), tracks_of(case)) == []


REJECTED = {expected_of(c)["rule"] for c in VERDICT if expected_of(c)["result"] == "reject"}
REPORTED = {m["rule"] for c in VERDICT for m in expected_of(c).get("image_mismatches", [])}
IMAGE_RULES = [rule for rule in r49.FORMAT_RULES if rule.startswith("images/")]


def test_every_format_rule_id_but_the_image_rules_is_rejected_at_least_once() -> None:
    missing = [r for r in r49.FORMAT_RULES if r not in IMAGE_RULES and r not in REJECTED]
    assert missing == []


def test_each_image_rule_is_reported_at_least_once_and_never_rejected() -> None:
    assert [rule for rule in IMAGE_RULES if rule not in REPORTED] == []
    assert [rule for rule in IMAGE_RULES if rule in REJECTED] == []


def test_cases_name_only_format_rule_ids() -> None:
    assert (REJECTED | REPORTED) - set(r49.FORMAT_RULES) == set()
