"""The only impure module: reads files, writes streams, chooses an exit code.

**stdout is machine, stderr is human — always both, with no flag.** The corpus
workflow pipes stdout through ``jq`` to make its annotations and its job
summary; a person running the same command reads stderr.

Exit codes:

* **0** — no blocking errors. Warnings do not change this.
* **1** — at least one archive carries a blocking error (or, for
  ``guidance --check``, the table is stale).
* **2** — the tool itself failed: bad arguments, an unreadable path, a bug.
  Distinct from 1 on purpose: a crash must never read as "your archive is bad".
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from collections.abc import Sequence
from pathlib import Path

from .corpus import handle_of
from .guidance import REFERENCE_WIDTH_PX, check_guidance, guidance_table
from .report import ArchiveReport, Report
from .validate import ArchiveInput, validate

USAGE = f"""\
r49-validate <path>...            validate .r49 files
r49-validate guidance             print the capture-guidance table
r49-validate guidance --check <path>
                                  check a document's generated block against it

Options:
  --author <handle>   the pull request author, for the directory-ownership rule
  --check <path>      guidance only; verify instead of print. Exit 1 on drift.
  --width <px>        guidance only; reference frame width (default {REFERENCE_WIDTH_PX})"""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        sys.stderr.write(f"{message}\n\n{USAGE}\n")
        raise SystemExit(2)


def _siblings(paths: Sequence[str]) -> list[ArchiveInput]:
    """Archives already committed beside a submission, for the id-collision check."""
    submitted = set(paths)
    directories = {os.path.dirname(p) for p in paths if handle_of(p) is not None}
    siblings: list[ArchiveInput] = []
    for directory in sorted(directories):
        try:
            entries = sorted(os.listdir(directory))
        except OSError:
            # A brand-new contributor directory does not exist until the merge.
            continue
        for entry in entries:
            path = os.path.join(directory, entry)
            if entry.endswith(".r49") and path not in submitted:
                siblings.append(ArchiveInput(path, Path(path).read_bytes()))
    return siblings


def _human_lines(report: ArchiveReport) -> list[str]:
    if report.images is None:
        facts = "did not load"
    else:
        dpt = "—" if report.dpt is None else f"{report.dpt:.1f}"
        residual = (
            "" if report.dpt_residual is None else f" (residual {report.dpt_residual:.1f} px)"
        )
        facts = f"{report.images} images, {report.labels} labels, DPT {dpt}{residual}"

    lines = [f"{'✅' if not report.errors else '❌'} {report.path} — {facts}"]
    if report.camera_height_mm is not None:
        railhead = (
            ""
            if report.reference_height_mm is None
            else f", railhead at {report.reference_height_mm:g} mm"
        )
        obliquity = (
            ""
            if report.obliquity_deg is None or report.width_inflation is None
            else f", worst obliquity {report.obliquity_deg:.0f}° "
            f"(cars up to {report.width_inflation:.1f}× their nadir width)"
        )
        lines.append(
            f"   camera  {report.camera_height_mm:g} mm above layout zero{railhead}{obliquity}"
        )
    lines += [f"   error   {e.message}" for e in report.errors]
    lines += [f"   warning {w.message}" for w in report.warnings]
    return lines


def _human_report(report: Report) -> str:
    lines = [line for a in report.archives for line in _human_lines(a)]
    errors = sum(len(a.errors) for a in report.archives)
    warnings = sum(len(a.warnings) for a in report.archives)
    lines += [
        "",
        f"{len(report.archives)} archive(s): {errors} blocking error(s), {warnings} warning(s).",
    ]
    return "\n".join(lines)


def _guidance(argv: Sequence[str]) -> int:
    parser = _Parser(prog="r49-validate guidance", add_help=False)
    parser.add_argument("--width", type=float, default=REFERENCE_WIDTH_PX)
    parser.add_argument("--check")
    args = parser.parse_args(argv)
    width: float = args.width
    if width <= 0:
        sys.stderr.write(f"--width must be a positive number, got {width:g}\n")
        return 2
    if args.check is not None:
        # Reported on stderr like every other human-facing rendering; stdout
        # stays empty so nothing is tempted to diff it a second time.
        ok, message = check_guidance(Path(args.check).read_text("utf-8"), width)
        sys.stderr.write(f"{args.check}: {message}\n")
        return 0 if ok else 1
    sys.stdout.write(guidance_table(width) + "\n")
    return 0


def run(argv: Sequence[str]) -> int:
    if argv and argv[0] == "guidance":
        return _guidance(argv[1:])

    parser = _Parser(prog="r49-validate", add_help=False)
    parser.add_argument("--author")
    parser.add_argument("--help", action="store_true")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args(argv)
    paths: list[str] = args.paths
    if args.help or not paths:
        sys.stderr.write(USAGE + "\n")
        return 0 if args.help else 2

    submitted = [ArchiveInput(p, Path(p).read_bytes()) for p in paths]
    report = validate(submitted, author=args.author, siblings=_siblings(paths))
    sys.stdout.write(json.dumps(report.to_json(), indent=2, ensure_ascii=False) + "\n")
    sys.stderr.write(_human_report(report) + "\n")
    return 0 if report.ok else 1


def main() -> None:
    try:
        code = run(sys.argv[1:])
    except SystemExit:
        raise
    except BaseException:
        # Exit 2, never 1: this is the tool failing, not an archive being rejected.
        sys.stderr.write(f"r49-validate failed: {traceback.format_exc()}")
        code = 2
    raise SystemExit(code)
