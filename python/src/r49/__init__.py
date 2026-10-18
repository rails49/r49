"""Read and validate ``.r49`` layout archives, and compute their calibration fit.

The format is defined in FORMAT.md at https://github.com/rails49/r49. This
package is read-only.
"""

from importlib.metadata import PackageNotFoundError, version

from ._data import RECOMMENDED_DPT, SCALE_TO_RATIO, SCALES, STANDARD_GAUGE, VOCABULARY
from .archive import Archive, load, manifest_from_json
from .errors import RULES, FormatError
from .fit import CalibrationFit, LeftOut, LeftOutReason, Pair, calibration_fit, gauge_mm
from .manifest import (
    MANIFEST_VERSION,
    Calibration,
    Camera,
    CarLabel,
    CorrectedLabel,
    HumanLabel,
    Image,
    Layout,
    Manifest,
    Point,
    ProposedLabel,
    ReferencePoint,
    Resolution,
    Sensor,
    WorldPoint,
    parse_manifest,
)
from .vocabulary import VocabularyNode, is_known_class, is_segment_prefix, vocabulary_subtypes

try:
    __version__ = version("rails49-r49")
except PackageNotFoundError:  # pragma: no cover - running from a source tree
    __version__ = "0+unknown"

__all__ = [
    "MANIFEST_VERSION",
    "RECOMMENDED_DPT",
    "RULES",
    "SCALES",
    "SCALE_TO_RATIO",
    "STANDARD_GAUGE",
    "VOCABULARY",
    "Archive",
    "CalibrationFit",
    "Calibration",
    "Camera",
    "CarLabel",
    "CorrectedLabel",
    "FormatError",
    "HumanLabel",
    "Image",
    "Layout",
    "LeftOut",
    "LeftOutReason",
    "Manifest",
    "Pair",
    "Point",
    "ProposedLabel",
    "ReferencePoint",
    "Resolution",
    "Sensor",
    "VocabularyNode",
    "WorldPoint",
    "calibration_fit",
    "gauge_mm",
    "is_known_class",
    "is_segment_prefix",
    "load",
    "manifest_from_json",
    "parse_manifest",
    "vocabulary_subtypes",
]
