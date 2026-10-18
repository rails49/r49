"""The data file, read once. Nothing here declares a value of its own."""

from __future__ import annotations

import json
from importlib.resources import files
from types import MappingProxyType
from typing import Any, cast


def _frozen(value: Any) -> Any:
    if isinstance(value, dict):
        node = cast(dict[str, Any], value)
        return MappingProxyType({k: _frozen(v) for k, v in node.items()})
    return value


_DATA = cast(dict[str, Any], json.loads(files("r49").joinpath("r49.json").read_text("utf-8")))

STANDARD_GAUGE: float = float(_DATA["standard_gauge"])
SCALE_TO_RATIO: MappingProxyType[str, float] = MappingProxyType(
    {name: float(ratio) for name, ratio in cast(dict[str, Any], _DATA["scale_to_ratio"]).items()}
)
SCALES: tuple[str, ...] = tuple(SCALE_TO_RATIO)
VOCABULARY: MappingProxyType[str, Any] = _frozen(_DATA["vocabulary"])
RECOMMENDED_DPT: float = float(_DATA["recommended_dpt"])
