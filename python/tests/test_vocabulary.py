"""The vocabulary questions an outside reader asks of a class string."""

from __future__ import annotations

from typing import Any

import r49


def test_known_classes_are_rooted_and_matched_by_segment() -> None:
    assert r49.is_known_class("stock")
    assert r49.is_known_class("stock.loco.steam")
    assert r49.is_known_class("stock.freight")
    assert not r49.is_known_class("loco.steam")
    assert not r49.is_known_class("stockyard")
    assert not r49.is_known_class("stock.loco.steam.2-8-0")
    assert not r49.is_known_class("")


def test_a_property_is_not_a_subtype() -> None:
    vocabulary: dict[str, Any] = {"stock": {"width_mm": 3200, "loco": {}}}
    assert [name for name, _ in r49.vocabulary_subtypes(vocabulary["stock"])] == ["loco"]
    assert r49.is_known_class("stock.loco", vocabulary)
    assert not r49.is_known_class("stock.width_mm", vocabulary)


def test_subtypes_come_in_authored_order() -> None:
    stock = dict(r49.vocabulary_subtypes(r49.VOCABULARY))["stock"]
    assert [name for name, _ in r49.vocabulary_subtypes(stock)] == ["loco", "passenger", "freight"]


def test_the_segment_prefix_rule() -> None:
    assert r49.is_segment_prefix("stock", "stock")
    assert r49.is_segment_prefix("stock", "stock.loco")
    assert not r49.is_segment_prefix("stock", "stockyard")
    assert not r49.is_segment_prefix("stock.loco", "stock")
