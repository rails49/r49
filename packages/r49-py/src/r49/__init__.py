"""Read ``.r49`` layout archives.

This module is the package's interface; anything not exported here is internal.
FORMAT.md defines the format, and the conformance cases are how this reader
shows it agrees with the TypeScript package, @rails49/r49.

Read-only: nothing here writes an archive.
"""

from .archive import R49Archive, load
from .calibration_fit import (
    CalibrationFit,
    CalibrationPair,
    LeftOutPoint,
    LeftOutReason,
    calibration_fit,
)
from .errors import FORMAT_RULES, FormatRule, ImageMismatch, R49Error
from .manifest import (
    MANIFEST_VERSION,
    VALID_SCALES,
    Calibration,
    Camera,
    CarLabel,
    Centerline,
    CenterlineNode,
    Image,
    Layout,
    Manifest,
    Point,
    Provenance,
    ReferencePoint,
    Resolution,
    Scale,
    Sensor,
    WorldPoint,
    parse_manifest,
)
from .vocabulary import (
    VocabularyNode,
    is_known_class,
    is_segment_prefix,
    vocabulary_subtypes,
)

__all__ = [
    "FORMAT_RULES",
    "MANIFEST_VERSION",
    "VALID_SCALES",
    "Calibration",
    "CalibrationFit",
    "CalibrationPair",
    "Camera",
    "CarLabel",
    "Centerline",
    "CenterlineNode",
    "FormatRule",
    "Image",
    "ImageMismatch",
    "Layout",
    "LeftOutPoint",
    "LeftOutReason",
    "Manifest",
    "Point",
    "Provenance",
    "R49Archive",
    "R49Error",
    "ReferencePoint",
    "Resolution",
    "Scale",
    "Sensor",
    "VocabularyNode",
    "WorldPoint",
    "calibration_fit",
    "is_known_class",
    "is_segment_prefix",
    "load",
    "parse_manifest",
    "vocabulary_subtypes",
]
