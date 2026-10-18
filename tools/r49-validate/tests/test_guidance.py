from __future__ import annotations

import pytest
import r49

from r49_validate.guidance import (
    COMMAND,
    REFERENCE_WIDTH_PX,
    check_guidance,
    extract_generated_block,
    guidance_table,
    max_frame_mm,
)


def document(block: str) -> str:
    return "\n".join(
        [
            "# Contributing",
            "",
            "<!-- BEGIN GENERATED — do not edit by hand.",
            f"     Produced by: {COMMAND}",
            "     CI diffs this block against that command's output. -->",
            "",
            block,
            "",
            "<!-- END GENERATED -->",
            "",
            "So for HO: about 1.6 m of track in frame.",
        ]
    )


@pytest.mark.parametrize("scale", r49.SCALES)
def test_the_frame_reaches_exactly_the_recommended_dpt(scale: str) -> None:
    frame = max_frame_mm(scale, 1920)
    assert (1920 / frame) * r49.gauge_mm(scale) == pytest.approx(r49.RECOMMENDED_DPT, abs=1e-10)


def test_scales_linearly_with_image_width() -> None:
    assert max_frame_mm("HO", 3840) == pytest.approx(max_frame_mm("HO", 1920) * 2)


def test_states_the_reference_width_and_the_recommended_dpt() -> None:
    assert "1920 px" in guidance_table(1920)
    assert "4032 px" in guidance_table(4032)
    assert f"Recommended DPT: **{r49.RECOMMENDED_DPT:g}**" in guidance_table()


def test_emits_one_row_per_scale_in_the_data_files_order() -> None:
    rows = [
        line
        for line in guidance_table().split("\n")
        if line.startswith("| ") and not line.startswith(("| Scale", "| :"))
    ]
    assert [row.split("|")[1].strip() for row in rows] == list(r49.SCALES)


def test_is_deterministic_and_rounded() -> None:
    assert guidance_table() == guidance_table(REFERENCE_WIDTH_PX)
    assert "16.49 mm" in guidance_table()


def test_reads_the_block_between_the_markers() -> None:
    assert extract_generated_block(document(guidance_table())) == guidance_table()


def test_survives_crlf_and_trailing_whitespace() -> None:
    assert check_guidance(document(guidance_table()).replace("\n", " \r\n"))[0]


def test_is_absent_when_a_marker_is_missing_or_reversed() -> None:
    block = guidance_table()
    assert extract_generated_block(f"no markers\n{block}") is None
    assert extract_generated_block(document(block).replace("<!-- END GENERATED -->", "")) is None
    assert extract_generated_block("<!-- END GENERATED -->\n<!-- BEGIN GENERATED -->") is None


def test_fails_a_stale_or_hand_edited_table_and_says_how_to_fix_it() -> None:
    ok, message = check_guidance(document(guidance_table(4032)))
    assert not ok
    assert "not about your submission" in message
    assert "recommended_dpt" in message
    assert COMMAND in message
    assert not check_guidance(document(guidance_table().replace("16.49 mm", "16.50 mm")))[0]


def test_offers_the_block_when_the_markers_are_gone() -> None:
    ok, message = check_guidance("# Contributing\n\nnothing generated here.\n")
    assert not ok
    assert guidance_table() in message
