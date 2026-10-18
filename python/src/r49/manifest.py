"""The version 4 manifest, as FORMAT.md § The manifest defines it.

Every model forbids unknown keys and coerces nothing but a JSON array to a tuple:
a string is not a number and a number is not a boolean. The only defaults are
the ones the format names.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any, Final, Literal, cast

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    Strict,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from . import errors
from ._data import SCALE_TO_RATIO
from .errors import FormatError

MANIFEST_VERSION: Final = 4
"""The format version this package reads. Separate from the package version."""


def _number(value: object) -> object:
    # JSON has one number type; a bool is not one of its values.
    if isinstance(value, bool):
        raise PydanticCustomError("number", "expected a number, got a boolean")
    return value


def _integer(value: object) -> object:
    # JSON does not tell 1920 from 1920.0, so neither may a reader.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


Number = Annotated[float, BeforeValidator(_number)]
Integer = Annotated[int, BeforeValidator(_integer), BeforeValidator(_number)]
NonEmpty = Annotated[str, Field(min_length=1)]


def _fields(data: object) -> Mapping[str, object]:
    """The keys of raw input that is an object; nothing for anything else."""
    return cast(Mapping[str, object], data) if isinstance(data, Mapping) else {}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def _no_nulls(cls, data: object) -> object:
        # No field of the format is nullable; absent is how a value is left out.
        for key, value in _fields(data).items():
            if value is None and key in cls.model_fields and key != "proposed_by":
                raise PydanticCustomError("null", "{key} may be absent, never null", {"key": key})
        return data


class Point(_Strict):
    """An image position, in pixels."""

    x: Number
    y: Number


class WorldPoint(_Strict):
    """A layout position, in mm from the layout's origin; ``z`` is height."""

    x: Number
    y: Number
    z: Number


class ReferencePoint(_Strict):
    """One feature, given both where it is in the image and where it is on the layout."""

    px: Point
    world: WorldPoint


class Calibration(_Strict):
    points: Annotated[tuple[ReferencePoint, ...], Strict(False)] = ()
    camera_height_mm: Annotated[Number, Field(gt=0)] | None = None
    reference_height_mm: Number | None = None


class Sensor(_Strict):
    id: NonEmpty
    x: Number
    y: Number
    name: str | None = None


def _unique_ids(kind: str, items: tuple[Any, ...]) -> None:
    ids = [item.id for item in items]
    if len(set(ids)) != len(ids):
        raise PydanticCustomError(
            "duplicate_id",
            "duplicate {kind} id: ids must be unique within their collection",
            {"kind": kind},
        )


class _Label(_Strict):
    id: NonEmpty
    # Any string: the vocabulary is a corpus rule, not a format rule.
    class_: str = Field(alias="class")
    p0: Point
    p1: Point


class HumanLabel(_Label):
    provenance: Literal["human"]

    @model_validator(mode="before")
    @classmethod
    def _no_proposer(cls, data: object) -> object:
        if "proposed_by" in _fields(data):
            raise PydanticCustomError("provenance", "proposed_by is forbidden on a human label")
        return data


class ProposedLabel(_Label):
    provenance: Literal["proposed"]
    proposed_by: NonEmpty


class CorrectedLabel(_Label):
    provenance: Literal["corrected"]
    proposed_by: NonEmpty


CarLabel = Annotated[HumanLabel | ProposedLabel | CorrectedLabel, Field(discriminator="provenance")]


class Layout(_Strict):
    name: str | None = None
    description: str | None = None
    contact: str | None = None
    scale: str
    calibration: Calibration = Calibration()
    sensors: Annotated[tuple[Sensor, ...], Strict(False)] = ()

    @field_validator("scale")
    @classmethod
    def _known_scale(cls, scale: str) -> str:
        if scale not in SCALE_TO_RATIO:
            raise PydanticCustomError("scale", "unknown scale {scale}", {"scale": scale})
        return scale

    @field_validator("sensors")
    @classmethod
    def _unique_sensors(cls, sensors: tuple[Sensor, ...]) -> tuple[Sensor, ...]:
        _unique_ids("sensor", sensors)
        return sensors


class Resolution(_Strict):
    width: Integer
    height: Integer


class Camera(_Strict):
    resolution: Resolution
    model: str | None = None


class Image(_Strict):
    filename: str
    labeled_complete: bool = False
    labels: Annotated[tuple[CarLabel, ...], Strict(False)] = ()

    @field_validator("labels")
    @classmethod
    def _unique_labels(cls, labels: tuple[CarLabel, ...]) -> tuple[CarLabel, ...]:
        _unique_ids("label", labels)
        return labels


class Manifest(_Strict):
    version: Literal[4]
    id: NonEmpty | None = None
    layout: Layout
    camera: Camera
    images: Annotated[tuple[Image, ...], Strict(False)] = ()


# When a manifest breaks several rules, report the one a reader can act on.
_PRIORITY: Final = (errors.UNKNOWN_KEY, errors.PROVENANCE, errors.DUPLICATE_ID, errors.FIELD)


def _rule_of(issue: Mapping[str, Any]) -> str:
    kind = issue["type"]
    if kind == "extra_forbidden":
        return errors.UNKNOWN_KEY
    if kind == "duplicate_id":
        return errors.DUPLICATE_ID
    if (
        kind in ("provenance", "union_tag_invalid", "union_tag_not_found")
        and "labels" in issue["loc"][-3:]
    ) or "proposed_by" in issue["loc"]:
        return errors.PROVENANCE
    return errors.FIELD


def _dotted(loc: tuple[int | str, ...]) -> str:
    return ".".join(str(part) for part in loc if part not in ("human", "proposed", "corrected"))


def parse_manifest(data: object) -> Manifest:
    """Validate parsed manifest JSON, raising :class:`FormatError` naming the rule broken.

    The version is checked first and on its own, so a version 3 manifest is
    refused for its version and not for the shape differences that follow from it.
    """
    if not isinstance(data, Mapping):
        raise FormatError(errors.MANIFEST_JSON, "manifest.json is not a JSON object")
    manifest = cast(Mapping[str, object], data)
    version = manifest.get("version")
    if isinstance(version, bool) or version != MANIFEST_VERSION:
        raise FormatError(
            errors.VERSION,
            f"Unsupported manifest version {version!r}: this package reads version "
            f"{MANIFEST_VERSION} only.",
        )
    try:
        return Manifest.model_validate({**manifest, "version": MANIFEST_VERSION})
    except ValidationError as err:
        issues = err.errors()
        found = {_rule_of(issue) for issue in issues}
        rule = next(r for r in _PRIORITY if r in found)
        if rule == errors.UNKNOWN_KEY:
            names = ", ".join(
                f"`{_dotted(i['loc'])}`" for i in issues if i["type"] == "extra_forbidden"
            )
            message = (
                f"This archive uses fields this package does not know ({names}). It may have "
                f"been written by a newer version of the format packages: upgrade rails49-r49 "
                f"and try again. If you hand-edited manifest.json, check the key names."
            )
        else:
            message = "; ".join(
                f"{_dotted(i['loc'])}: {i['msg']}" for i in issues if _rule_of(i) == rule
            )
        raise FormatError(rule, message) from None
