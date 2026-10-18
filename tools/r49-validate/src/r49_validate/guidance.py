"""The capture-guidance table CONTRIBUTING.md carries.

The widest strip of track that may span a reference frame and still reach the
recommended DPT, per scale. **Printed, never typed**: the table is derived from
``recommended_dpt`` and the scale table in ``data/r49.json``, and CI diffs the
committed prose against this output, which is why it has a fixed column order
and fixed rounding.

    DPT          = px_per_mm × gauge_mm
    gauge_mm     = standard gauge / scale ratio
    max_frame_mm = width_px × gauge_mm / recommended DPT
"""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

import r49

REFERENCE_WIDTH_PX = 1920
"""The frame the committed table is computed for.

1920 is what every image in the corpus is today and what a plain 1080p frame
gives. The numbers scale linearly with width; the committed guidance stays the
conservative one.
"""

COMMAND = "uv run --quiet --package r49-validate r49-validate guidance"
"""How to regenerate the table, from the repository root."""

_BEGIN = "BEGIN GENERATED"
_END = "END GENERATED"


def max_frame_mm(scale: str, width_px: float) -> float:
    """The widest strip of track, in mm, that may span a frame of ``width_px``."""
    return width_px * r49.gauge_mm(scale) / r49.RECOMMENDED_DPT


def _fixed(value: float, places: int) -> str:
    # Half away from zero on the exact binary value, as the table has always
    # been rounded: 2152.5 mm prints as 2153, where format() would print 2152.
    return str(Decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def _number(value: float) -> str:
    return f"{value:g}" if value == int(value) else str(value)


def guidance_table(width_px: float = REFERENCE_WIDTH_PX) -> str:
    """The table, as markdown, ready to paste between the generated-block markers.

    The reference width is stated in the output because it is an input to every
    number below it.
    """
    width = _number(width_px)
    lines = [
        f"Reference frame: **{width} px** wide. "
        f"Recommended DPT: **{_number(r49.RECOMMENDED_DPT)}**.",
        "",
        "| Scale | Ratio | Track gauge | Widest track that may span the frame |",
        "| :--- | ---: | ---: | ---: |",
    ]
    for scale in r49.SCALES:
        frame = max_frame_mm(scale, width_px)
        lines.append(
            f"| {scale} | 1:{_number(r49.SCALE_TO_RATIO[scale])} | "
            f"{_fixed(r49.gauge_mm(scale), 2)} mm | "
            f"{_fixed(frame, 0)} mm ({_fixed(frame / 1000, 2)} m) |"
        )
    lines += [
        "",
        "Shoot a **narrower** strip than the figure for your scale and you are above the",
        "recommended DPT; shoot a wider one and cars are too few pixels across to localise",
        f"reliably. The numbers scale linearly with image width — at {_number(width_px * 2)} px "
        f"they double.",
    ]
    return "\n".join(lines)


def _normalise(text: str) -> str:
    # CRLF and trailing spaces are noise; a Windows contributor must not fail on them.
    lines = [line.rstrip() for line in re.sub(r"\r\n?", "\n", text).split("\n")]
    return "\n".join(lines).strip("\n")


def extract_generated_block(markdown: str) -> str | None:
    """The generated block out of a document, or ``None`` when the markers are missing.

    The opening marker sits inside an HTML comment that may span several lines;
    the block starts after that comment closes.
    """
    lines = re.sub(r"\r\n?", "\n", markdown).split("\n")
    begin = next((i for i, line in enumerate(lines) if _BEGIN in line), None)
    if begin is None:
        return None
    opener_ends = next((i for i in range(begin, len(lines)) if "-->" in lines[i]), None)
    if opener_ends is None:
        return None
    end = next((i for i in range(opener_ends + 1, len(lines)) if _END in lines[i]), None)
    if end is None:
        return None
    return _normalise("\n".join(lines[opener_ends + 1 : end]))


def check_guidance(markdown: str, width_px: float = REFERENCE_WIDTH_PX) -> tuple[bool, str]:
    """Whether a document's generated block still matches :func:`guidance_table`."""
    expected = _normalise(guidance_table(width_px))
    found = extract_generated_block(markdown)

    if found is None:
        return (
            False,
            f'The generated capture-guidance block is missing or malformed: no "{_BEGIN}" '
            f'comment, no closing "{_END}", or the two in the wrong order. The block is derived '
            f"from recommended_dpt in data/r49.json and must not be deleted — restore the "
            f"markers and put this between them:\n\n{expected}\n",
        )
    if found == expected:
        return True, "The capture-guidance table is up to date."
    return (
        False,
        "The capture-guidance table is out of date.\n\n"
        "**This is almost certainly not about your submission.** The table is derived from "
        "recommended_dpt and the scale table in data/r49.json, so a change there makes "
        "CONTRIBUTING.md stale until the table is regenerated. A maintainer can do it if you "
        "would rather not.\n\n"
        f"From the repository root, run:\n\n    {COMMAND}\n\n"
        "and paste its output between the generated-block markers in CONTRIBUTING.md.\n\n"
        f"Expected:\n\n{expected}\n\nFound:\n\n{found}\n",
    )
