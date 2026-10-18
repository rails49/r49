"""Read ``.r49`` layout archives.

This module is the package's interface; anything not exported here is internal.
FORMAT.md defines the format, and the conformance cases are how this reader
shows it agrees with the TypeScript package, @rails49/r49.

Read-only: nothing here writes an archive.
"""

from .archive import R49Archive, load
from .errors import FORMAT_RULE_IDS, FormatRuleId, R49Error
from .fit import CalibrationFit, LeftOut, LeftOutReason, fit
from .manifest import (
    MANIFEST_VERSION,
    VALID_SCALES,
    Calibration,
    Camera,
    CarLabel,
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
    detector_class_index,
    is_known_class,
    is_segment_prefix,
    vocabulary_subtypes,
)

__all__ = [
    "FORMAT_RULE_IDS",
    "MANIFEST_VERSION",
    "VALID_SCALES",
    "Calibration",
    "CalibrationFit",
    "Camera",
    "CarLabel",
    "FormatRuleId",
    "Image",
    "Layout",
    "LeftOut",
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
    "detector_class_index",
    "fit",
    "is_known_class",
    "is_segment_prefix",
    "load",
    "parse_manifest",
    "vocabulary_subtypes",
]
