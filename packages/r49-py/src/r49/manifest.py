"""The v4 manifest: its shape, and parsing it under every format rule.

Every model forbids unknown keys and validates strictly. An unknown key is
refused, not dropped: a reader that dropped it would save a newer archive
shorter than it arrived (FORMAT.md § Strictness). Strict, because a JSON
``"1"`` is not a number and ``true`` is not one either.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Final, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_core import ErrorDetails, PydanticCustomError

from .data import SCALE_TO_RATIO
from .errors import FormatRule, R49Error

MANIFEST_VERSION: Final = 4
"""The format version this package reads. Anything else is refused on the
version alone; there is no version 3 path."""

VALID_SCALES: Final[tuple[str, ...]] = tuple(SCALE_TO_RATIO)
"""Every valid scale name, in the order ``data.json`` defines them."""


def _whole(value: object) -> object:
    # JSON has numbers, not integers: `1920.0` is the integer 1920, as it is
    # to the TypeScript package. A float with a fraction stays a float and
    # fails the strict int.
    if type(value) is float and value.is_integer():
        return int(value)
    return value


def _known_scale(value: str) -> str:
    if value not in SCALE_TO_RATIO:
        raise ValueError(f"unknown scale {value!r}: one of {', '.join(VALID_SCALES)}")
    return value


_Integer = Annotated[int, BeforeValidator(_whole)]
_NonEmpty = Annotated[str, Field(min_length=1)]
Scale = Annotated[str, AfterValidator(_known_scale)]
"""A scale name: one of :data:`VALID_SCALES`."""


class _Strict(BaseModel):
    # allow_inf_nan: JSON can spell `1e999`, which parses to infinity, and no
    # field of the format can hold it (rails49/occupancy#190).
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False, frozen=True)

    @field_validator("*", mode="before")
    @classmethod
    def _no_null(cls, value: object) -> object:
        # No field of the format holds null. An optional key is absent, never
        # null, so a None here was written as `null`, not defaulted.
        if value is None:
            raise ValueError("null is not a value any field holds; leave the key out instead")
        return value


class Point(_Strict):
    """An image position, in pixels: ``x`` to the right, ``y`` down."""

    x: float
    y: float


class WorldPoint(_Strict):
    """A layout position in mm; ``z`` is the height above layout zero."""

    x: float
    y: float
    z: float


class ReferencePoint(_Strict):
    """A feature given both as an image position and as a layout position."""

    px: Point
    world: WorldPoint


class Calibration(_Strict):
    """The reference points that fix a layout's DPT."""

    points: list[ReferencePoint] = []
    camera_height_mm: float | None = Field(default=None, gt=0)
    """The camera height above layout zero, in mm; None when absent."""
    reference_height_mm: float | None = None
    """The reference height in mm; None when absent, which reads as 0."""


def _unique_ids(kind: str, items: list[Sensor] | list[CarLabel]) -> None:
    ids = [item.id for item in items]
    if len(set(ids)) != len(ids):
        raise PydanticCustomError(
            "duplicate_id",
            "duplicate {kind} id: ids must be unique within their collection",
            {"kind": kind},
        )


class Sensor(_Strict):
    """A point on the layout where occupancy must be reported."""

    id: _NonEmpty
    x: float
    y: float
    name: str | None = None


Provenance = Literal["human", "proposed", "corrected"]
"""How a car label came to exist."""


class CarLabel(_Strict):
    """One car: its class, its span and its provenance.

    ``class`` is a Python keyword, so the field is ``class_``; the key in the
    manifest is ``class``.
    """

    id: _NonEmpty
    class_: str = Field(alias="class")
    p0: Point
    p1: Point
    provenance: Provenance
    proposed_by: str | None = None
    """The proposing model's version; None exactly when ``provenance`` is human."""

    @model_validator(mode="after")
    def _proposed_by_follows_provenance(self) -> CarLabel:
        if self.provenance == "human":
            if "proposed_by" in self.model_fields_set:
                raise PydanticCustomError("provenance", "proposed_by is forbidden on human")
        elif not self.proposed_by:
            raise PydanticCustomError(
                "provenance",
                "proposed_by is required and non-empty on {provenance}",
                {"provenance": self.provenance},
            )
        return self


class Image(_Strict):
    """One photograph of the layout, and the cars labeled in it."""

    filename: str
    labeled_complete: bool = False
    labels: list[CarLabel] = []

    @field_validator("labels")
    @classmethod
    def _unique_label_ids(cls, labels: list[CarLabel]) -> list[CarLabel]:
        _unique_ids("label", labels)
        return labels


class Layout(_Strict):
    """The layout the camera sees."""

    name: str | None = None
    description: str | None = None
    contact: str | None = None
    scale: Scale
    calibration: Calibration = Field(default_factory=Calibration)
    sensors: list[Sensor] = []

    @field_validator("sensors")
    @classmethod
    def _unique_sensor_ids(cls, sensors: list[Sensor]) -> list[Sensor]:
        _unique_ids("sensor", sensors)
        return sensors


class Resolution(_Strict):
    """The frame every image position is in."""

    width: _Integer
    height: _Integer


class Camera(_Strict):
    """The camera the images were taken with."""

    resolution: Resolution
    model: str | None = None


class Manifest(_Strict):
    """A parsed, validated v4 manifest. Absent optional keys read as FORMAT.md
    says; ``model_fields_set`` tells which were present."""

    version: _Integer
    id: _NonEmpty | None = None
    layout: Layout
    camera: Camera
    images: list[Image] = []


def parse_manifest(data: bytes) -> Manifest:
    """Parse ``manifest.json`` bytes: UTF-8, then JSON, then the version, then
    everything else, each refusal under its own rule id.

    A bare manifest is exempt from the zip and image rules. :func:`r49.load`
    applies the zip rules, and :meth:`r49.R49Archive.image_mismatches` reports
    the image rules.

    :raises R49Error: ``manifest/not-json``, ``manifest/version``,
        ``manifest/unknown-key``, ``manifest/provenance``,
        ``manifest/duplicate-id`` or ``manifest/schema``.
    """
    try:
        # Strict: an invalid byte must not load as U+FFFD (rails49/occupancy#191).
        # json refuses a leading byte-order mark, as FORMAT.md does.
        value: object = json.loads(data.decode("utf-8"), parse_constant=_refuse_constant)
    except ValueError as err:
        raise R49Error("manifest/not-json", f"manifest.json is not UTF-8 JSON: {err}") from None
    # A JSON value that is not an object has no version 4.
    if not isinstance(value, dict):
        value = {}
    manifest: dict[str, Any] = value  # pyright: ignore[reportUnknownVariableType]
    _assert_version(manifest)
    try:
        return Manifest.model_validate(manifest)
    except ValidationError as err:
        raise _refusal(err) from None


def _refuse_constant(name: str) -> object:
    # Python's json reads NaN, Infinity and -Infinity; JSON has none of them.
    raise ValueError(f"{name} is not JSON")


def _assert_version(manifest: dict[str, Any]) -> None:
    """Refuse a manifest that is not version 4 before anything else is read."""
    version = manifest.get("version")
    if type(version) in (int, float) and version == MANIFEST_VERSION:
        return
    raise R49Error(
        "manifest/version",
        f"Unsupported manifest version {json.dumps(version)}: this reader reads version "
        f"{MANIFEST_VERSION} only, and there is no conversion from version 3.",
    )


def _refusal(err: ValidationError) -> R49Error:
    """The R49Error for a failed validation. When several rules are broken at
    once, an unknown key is reported first: it is the one most likely to explain
    the others."""
    issues = err.errors()
    unknown = [_dotted(issue) for issue in issues if issue["type"] == "extra_forbidden"]
    if unknown:
        names = ", ".join(f"`{key}`" for key in unknown)
        one = len(unknown) == 1
        return R49Error(
            "manifest/unknown-key",
            f"This archive uses {'a field' if one else 'fields'} this version of rails49-r49 "
            f"does not know ({names}). It may have been written for a newer version of the "
            f".r49 format, which a newer version of rails49-r49 can read. If manifest.json "
            f"was edited by hand, check the key {'name' if one else 'names'}.",
        )
    return R49Error(_rule(issues), str(err))


def _rule(issues: list[ErrorDetails]) -> FormatRule:
    def at(issue: ErrorDetails) -> object:
        return issue["loc"][-1] if issue["loc"] else None

    if any(i["type"] == "provenance" or at(i) in ("provenance", "proposed_by") for i in issues):
        return "manifest/provenance"
    if any(i["type"] == "duplicate_id" for i in issues):
        return "manifest/duplicate-id"
    return "manifest/schema"


def _dotted(issue: ErrorDetails) -> str:
    return ".".join(str(part) for part in issue["loc"])
