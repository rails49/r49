"""The format's tables, read from ``data.json``.

The file is the TypeScript package's own (``packages/r49/src/data.json``, linked
here), so both readers compute with the same numbers. FORMAT.md § Scales and
gauge and § The vocabulary state them in prose. No value is restated in code.
"""

from __future__ import annotations

import json
from importlib.resources import files
from typing import Any, Final

_DATA: Final[dict[str, Any]] = json.loads(
    files(__package__).joinpath("data.json").read_text(encoding="utf-8")
)

STANDARD_GAUGE: Final[float] = _DATA["standard_gauge"]
"""The prototype's standard gauge in mm."""

SCALE_TO_RATIO: Final[dict[str, float]] = _DATA["scale_to_ratio"]
"""Scale name to reduction ratio (HO is 1:87)."""

VOCABULARY: Final[dict[str, Any]] = _DATA["vocabulary"]
"""The vocabulary: what a label's ``class`` should match."""
