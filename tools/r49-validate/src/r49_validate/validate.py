"""What CI asserts about a corpus submission, over archives already read into memory.

Pure by construction: bytes in, report out, no filesystem and no process.
``cli.py`` does the reading and the exiting. The rules are FORMAT.md § Corpus
rules; this module and ``corpus.py`` implement them.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

import r49

from .corpus import check_path, handle_of, scope_of
from .geometry import obliquity_of, points_off_reference_plane
from .report import ArchiveReport, Finding, Report


@dataclass(frozen=True)
class ArchiveInput:
    """One archive to examine, with the repo-relative path it sits at."""

    path: str
    data: bytes


def _facts(path: str, archive: r49.Archive, fit: r49.CalibrationFit) -> ArchiveReport:
    manifest = archive.manifest
    calibration = manifest.layout.calibration
    obliquity = obliquity_of(manifest)
    images = manifest.images
    return ArchiveReport(
        path=path,
        scope=scope_of(path),
        id=manifest.id,
        dpt=fit.dpt,
        dpt_residual=fit.residual,
        camera_height_mm=calibration.camera_height_mm,
        reference_height_mm=calibration.reference_height_mm,
        obliquity_deg=None if obliquity is None else obliquity.degrees,
        width_inflation=None if obliquity is None else obliquity.width_inflation,
        images=len(images),
        labels=sum(len(image.labels) for image in images),
        complete=sum(1 for image in images if image.labeled_complete),
        incomplete=sum(1 for image in images if not image.labeled_complete),
    )


def _check_images(archive: r49.Archive) -> list[Finding]:
    """The manifest and the zip must name the same images, both ways."""
    declared = [image.filename for image in archive.manifest.images]
    present = set(archive.entries())
    findings = [
        Finding(
            "images/missing",
            f"The manifest names {name}, but the archive contains no such file.",
        )
        for name in declared
        if name not in present
    ]
    referenced = set(declared)
    findings += [
        Finding(
            "images/orphan",
            f"{entry} is in the archive but no manifest entry references it. "
            f"An unreferenced image is weight the corpus carries in git forever.",
        )
        for entry in sorted(present)
        if entry != "manifest.json" and entry not in referenced
    ]
    return findings


def _check_labels(archive: r49.Archive) -> list[Finding]:
    """What a label may claim, and what it may be called."""
    findings: list[Finding] = []
    for image in archive.manifest.images:
        for label in image.labels:
            if label.provenance == "proposed":
                findings.append(
                    Finding(
                        "labels/provenance",
                        f'{image.filename}: label {label.id} is still "proposed" — untouched '
                        f"model output. Review it in the editor: accepting or adjusting a "
                        f'proposal records it as "corrected", which is accepted here. Training on '
                        f"unreviewed proposals is the one thing this corpus exists to prevent.",
                    )
                )
            if not r49.is_known_class(label.class_):
                findings.append(
                    Finding(
                        "labels/class",
                        f'{image.filename}: label {label.id} has class "{label.class_}", which '
                        f"is not in the vocabulary (vocabulary in data/r49.json; see FORMAT.md § "
                        f"The vocabulary). If your rolling stock genuinely is not representable, "
                        f"please open an issue — the vocabulary is meant to grow.",
                    )
                )
    return findings


def _quality_warnings(report: ArchiveReport, fit: r49.CalibrationFit) -> list[Finding]:
    """Signals for the maintainer; never blocking.

    Deliberately not a warning: a missing camera height. It would fire on every
    submission, fixtures included, and a warning that always fires devalues the
    ones that mean something.
    """
    warnings: list[Finding] = []

    off_plane = points_off_reference_plane(fit)
    if off_plane > 0:
        one = off_plane == 1
        warnings.append(
            Finding(
                "calibration/off-reference-plane",
                f"{off_plane} calibration point{' sits' if one else 's sit'} off the plane DPT is "
                f"measured on, and without a camera height {'it is' if one else 'they are'} "
                f"excluded from the fit. Add layout.calibration.camera_height_mm so every point "
                f"contributes, or move {'it' if one else 'them'} onto the reference plane.",
            )
        )

    if report.dpt is None:
        warnings.append(
            Finding(
                "calibration/unresolved",
                "Calibration does not resolve, so no DPT can be computed and no geometric claim "
                "about this archive can be checked. Add two calibration points at known, "
                "differing world coordinates in the editor.",
            )
        )
    elif report.dpt < r49.RECOMMENDED_DPT:
        warnings.append(
            Finding(
                "calibration/dpt",
                f"DPT is {report.dpt:.1f}, below the recommended {r49.RECOMMENDED_DPT:g}. Move "
                f"the camera closer or frame a shorter stretch of track — or submit as is: this "
                f"is a warning, and a coarse archive is still accepted.",
            )
        )

    if (report.incomplete or 0) > 0:
        warnings.append(
            Finding(
                "images/incomplete",
                f"{report.incomplete} of {report.images} images are not marked complete. Only a "
                f"complete image can be trained on — its unlabeled areas are what teach the "
                f"detector what background looks like.",
            )
        )

    return warnings


def _id_of(data: bytes) -> str | None:
    # A sibling that does not load is not this pull request's problem.
    try:
        return r49.load(data).manifest.id
    except r49.FormatError:
        return None


def _id_collisions(
    submitted: Sequence[tuple[str, str | None]], siblings: Sequence[ArchiveInput]
) -> dict[str, Finding]:
    """Two archives in one contributor directory must not share an id.

    Compares each submission against its committed siblings and against the
    other submissions in the same directory.
    """
    committed: dict[tuple[str | None, str], str] = {}
    for sibling in siblings:
        sibling_id = _id_of(sibling.data)
        if sibling_id is not None:
            committed[(handle_of(sibling.path), sibling_id)] = sibling.path

    clashes: dict[str, Finding] = {}
    seen: dict[tuple[str | None, str], str] = {}
    for path, archive_id in submitted:
        handle = handle_of(path)
        if archive_id is None or handle is None:
            continue
        key = (handle, archive_id)
        clash = committed.get(key, seen.get(key))
        if clash is not None and clash != path:
            clashes[path] = Finding(
                "archive/id-collision",
                f"This archive's id ({archive_id}) already exists at {clash}. If you meant to "
                f"update that archive, replace the file rather than adding a second one — the id "
                f"is its identity, and the path is only where it happens to live.",
            )
        seen[key] = path
    return clashes


def validate(
    submitted: Sequence[ArchiveInput],
    author: str | None = None,
    siblings: Sequence[ArchiveInput] = (),
) -> Report:
    """Validate a set of submitted archives.

    ``author`` is the pull request author's handle; ``None`` skips only the
    ownership rule. ``siblings`` are archives already committed in the
    submitters' directories, read for their ids alone.

    ``fixtures/`` is held to a thinner bar — the archive loads, its images
    agree, its path has the right shape — and gets no warnings at all.
    """
    reports: dict[str, ArchiveReport] = {}
    loaded: list[tuple[str, str | None]] = []

    for item in submitted:
        scope = scope_of(item.path)
        try:
            archive = r49.load(item.data)
        except r49.FormatError as err:
            reports[item.path] = ArchiveReport(
                path=item.path,
                scope=scope,
                errors=(
                    Finding(
                        "archive/load",
                        f"{item.path} could not be read as a v4 .r49 archive "
                        f"({err.rule}): {err}",
                    ),
                ),
            )
            continue

        fit = r49.calibration_fit(archive.manifest)
        report = _facts(item.path, archive, fit)
        errors = [*check_path(item.path, author), *_check_images(archive)]
        warnings: list[Finding] = []
        if scope != "fixtures":
            errors += _check_labels(archive)
            if report.id is None:
                errors.append(
                    Finding(
                        "archive/id",
                        f"{item.path} has no archive-level id. Open it in the editor and save — "
                        f"every save mints one if it is missing, and never changes one that is "
                        f"already there.",
                    )
                )
            warnings = _quality_warnings(report, fit)

        loaded.append((item.path, report.id))
        reports[item.path] = _with(report, errors, warnings)

    in_archives = [(path, i) for path, i in loaded if scope_of(path) == "archives"]
    for path, finding in _id_collisions(in_archives, siblings).items():
        report = reports[path]
        reports[path] = _with(report, [*report.errors, finding], list(report.warnings))

    return Report(tuple(reports[item.path] for item in submitted))


def _with(report: ArchiveReport, errors: list[Finding], warnings: list[Finding]) -> ArchiveReport:
    return replace(report, errors=tuple(errors), warnings=tuple(warnings))
