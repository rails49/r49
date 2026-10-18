"""Archives built in memory, so a check can be triggered exactly."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

A_JPEG = b"\xff\xd8\xff\xd9"

# Two reference points far enough apart to clear the recommended DPT at HO.
CALIBRATED: list[dict[str, Any]] = [
    {"px": {"x": 0, "y": 0}, "world": {"x": 0, "y": 0, "z": 0}},
    {"px": {"x": 1000, "y": 0}, "world": {"x": 800, "y": 0, "z": 0}},
]


def car(**over: Any) -> dict[str, Any]:
    label: dict[str, Any] = {
        "id": "car-1",
        "class": "stock",
        "p0": {"x": 10, "y": 20},
        "p1": {"x": 110, "y": 25},
        "provenance": "human",
    }
    label.update(over)
    return label


def build(
    *,
    archive_id: str | None = "aBcDeFgHiJk",
    calibration: list[dict[str, Any]] | None = None,
    labels: list[dict[str, Any]] | None = None,
    complete: bool = True,
    images: int = 1,
    extra_entry: str | None = None,
    missing_image: bool = False,
    camera_height_mm: float | None = None,
) -> bytes:
    cal: dict[str, Any] = {"points": CALIBRATED if calibration is None else calibration}
    if camera_height_mm is not None:
        cal["camera_height_mm"] = camera_height_mm
    manifest: dict[str, Any] = {
        "version": 4,
        "layout": {"scale": "HO", "calibration": cal, "sensors": []},
        "camera": {"resolution": {"width": 1920, "height": 1080}},
        "images": [
            {
                "filename": f"img_{i}.jpg",
                "labeled_complete": complete,
                "labels": (labels or []) if i == 0 else [],
            }
            for i in range(images)
        ],
    }
    if archive_id is not None:
        manifest["id"] = archive_id

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        if not missing_image:
            for i in range(images):
                z.writestr(f"img_{i}.jpg", A_JPEG)
        if extra_entry is not None:
            z.writestr(extra_entry, A_JPEG)
    return buf.getvalue()
