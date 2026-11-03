"""The curve between two nodes (FORMAT.md § Node), and the nearest point on a
track. The closed-form values every reader agrees on are the conformance cases,
``curve-*`` and ``nearest-*``; these are the properties around them."""

from __future__ import annotations

import math

import pytest

import r49


def node(x: float, y: float, heading: float) -> r49.TrackNode:
    return r49.TrackNode(x=x, y=y, heading=heading)


def test_wrap_angle_maps_into_minus_pi_to_pi() -> None:
    assert r49.wrap_angle(0) == 0
    assert r49.wrap_angle(math.pi) == math.pi
    assert r49.wrap_angle(-math.pi) == math.pi
    assert r49.wrap_angle(3 * math.pi / 2) == pytest.approx(-math.pi / 2, abs=1e-12)
    assert r49.wrap_angle(-5 * math.pi / 2) == pytest.approx(-math.pi / 2, abs=1e-12)
    assert r49.wrap_angle(7 * math.pi) == pytest.approx(math.pi, abs=1e-12)


def test_a_segment_leaves_each_node_along_its_heading() -> None:
    s = r49.segment(node(0, 0, 0.3), node(200, 80, 0.5 + 2 * math.pi))
    assert r49.heading_at(s, 0) == pytest.approx(0.3, abs=1e-12)
    assert r49.heading_at(s, 1) == pytest.approx(0.5, abs=1e-12)


@pytest.mark.parametrize("turn", [0.1, 0.5, 1, math.pi / 4, math.pi / 2])
def test_a_symmetric_segment_stays_within_three_hundredths_of_a_percent_of_the_arc(
    turn: float,
) -> None:
    # The arc of radius 100 about the origin, from angle -turn/2 to +turn/2.
    def end(a: float) -> r49.TrackNode:
        return node(100 * math.cos(a), 100 * math.sin(a), a + math.pi / 2)

    s = r49.segment(end(-turn / 2), end(turn / 2))
    for k in range(101):
        p = r49.point_at(s, k / 100)
        assert abs(math.hypot(p.x, p.y) - 100) < 0.03


def test_nearest_on_no_tracks_is_none() -> None:
    assert r49.nearest_on_track([], r49.Point(x=0, y=0)) is None
