"""The one shape both surfaces read.

A corpus pull request is reported in two places — ``::warning`` annotations on
the archive's path, and a table on the run's job summary — and they must never
disagree about what was found. So the validator produces this, and the workflow
renders it twice. Nothing about GitHub appears here: the tool decides what is
true, the workflow decides how it is displayed.

Blocking errors and warnings are separate fields rather than one list with a
severity, because the distinction is the whole point of the soft bar and a
consumer must not have to filter correctly to respect it.

The JSON keys are camelCase because the workflow's ``jq`` reads them, and they
are unchanged from the validator's time in rails49/occupancy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Scope = Literal["archives", "fixtures", "unknown"]
"""Which bar an archive is held to: a submission, one of the six fixtures, or neither."""


@dataclass(frozen=True)
class Finding:
    code: str
    """Stable machine name, safe to match on. The message may be reworded."""
    message: str
    """One sentence, addressed to the contributor, naming the fix where there is one."""


@dataclass(frozen=True)
class ArchiveReport:
    """Everything known about one archive.

    The facts are present even when the archive failed to load — ``path`` and
    ``scope`` always, the rest ``None`` — so a row exists for every file.
    """

    path: str
    scope: Scope
    id: str | None = None
    dpt: float | None = None
    """Dots per track, or ``None`` when calibration does not resolve."""
    dpt_residual: float | None = None
    """The fit's disagreement in image pixels. Reported, never thresholded."""
    camera_height_mm: float | None = None
    """Reported, never required: every archive predates the field."""
    reference_height_mm: float | None = None
    obliquity_deg: float | None = None
    width_inflation: float | None = None
    images: int | None = None
    labels: int | None = None
    complete: int | None = None
    incomplete: int | None = None
    errors: tuple[Finding, ...] = field(default=())
    warnings: tuple[Finding, ...] = field(default=())

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "scope": self.scope,
            "id": self.id,
            "dpt": self.dpt,
            "dptResidual": self.dpt_residual,
            "cameraHeightMM": self.camera_height_mm,
            "referenceHeightMM": self.reference_height_mm,
            "obliquityDeg": self.obliquity_deg,
            "widthInflation": self.width_inflation,
            "images": self.images,
            "labels": self.labels,
            "complete": self.complete,
            "incomplete": self.incomplete,
            "errors": [{"code": f.code, "message": f.message} for f in self.errors],
            "warnings": [{"code": f.code, "message": f.message} for f in self.warnings],
        }


@dataclass(frozen=True)
class Report:
    """The whole run."""

    archives: tuple[ArchiveReport, ...]

    @property
    def ok(self) -> bool:
        """True when no archive carries a blocking error. Warnings do not clear it."""
        return all(not a.errors for a in self.archives)

    def to_json(self) -> dict[str, Any]:
        # `version` is bumped when a consumer would have to change. The workflow pins it.
        return {"version": 1, "archives": [a.to_json() for a in self.archives], "ok": self.ok}
