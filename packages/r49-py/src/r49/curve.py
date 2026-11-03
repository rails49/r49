"""The curve between a track's nodes, as FORMAT.md § Node defines it, and the
point on a set of tracks nearest a given one."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

from .manifest import Point, Track, TrackNode

_SAMPLE_PX = 2.0
"""Spacing, in image pixels, of the samples ``nearest_on_track`` starts from."""


@dataclass(frozen=True)
class Segment:
    """The cubic Bézier between two consecutive nodes of a track: from ``p0``
    to ``p1``, with control points ``c0`` and ``c1``. FORMAT.md § Node defines it."""

    p0: Point
    c0: Point
    c1: Point
    p1: Point


@dataclass(frozen=True)
class NearestPoint:
    """The point on a set of tracks nearest a given one, from ``nearest_on_track``."""

    track: int
    """The index of the track the point is on."""
    point: Point
    heading: float
    """The direction the track runs at the point, in radians, in (−π, π]."""
    distance: float
    """From the given point to ``point``, in image pixels."""


def wrap_angle(angle: float) -> float:
    """``angle``, in radians, brought into (−π, π]. Any finite number goes in;
    angles that differ by a multiple of 2π come out the same. FORMAT.md § Node."""
    wrapped = angle - 2 * math.pi * math.floor((angle + math.pi) / (2 * math.pi))
    return math.pi if wrapped == -math.pi else wrapped


def segment(a: TrackNode, b: TrackNode) -> Segment:
    """The curve from node ``a`` to node ``b``, as FORMAT.md § Node defines it:
    each control point lies along its node's heading, at ``d / (3 · cos²(φ / 4))``,
    with ``d`` the distance from ``a`` to ``b`` and ``φ`` the turn brought into
    (−π, π]."""
    d = math.hypot(b.x - a.x, b.y - a.y)
    h = d / (3 * math.cos(wrap_angle(b.heading - a.heading) / 4) ** 2)
    return Segment(
        p0=Point(x=a.x, y=a.y),
        c0=Point(x=a.x + h * math.cos(a.heading), y=a.y + h * math.sin(a.heading)),
        c1=Point(x=b.x - h * math.cos(b.heading), y=b.y - h * math.sin(b.heading)),
        p1=Point(x=b.x, y=b.y),
    )


def point_at(s: Segment, t: float) -> Point:
    """The point on ``s`` at ``t`` in [0, 1]: ``p0`` at 0, ``p1`` at 1. FORMAT.md § Node."""
    x, y = _point(s, t)
    return Point(x=x, y=y)


def heading_at(s: Segment, t: float) -> float:
    """The direction ``s`` runs at ``t`` in [0, 1], in radians, in (−π, π]: the
    direction of the curve's derivative. FORMAT.md § Node."""
    vx, vy = _derivative(s, t)
    return wrap_angle(math.atan2(vy, vx))


def nearest_on_track(tracks: Sequence[Track], at: Point) -> NearestPoint | None:
    """The point on ``tracks`` nearest ``at``, at any distance, or None when
    there are no tracks. Each segment is sampled every couple of image pixels,
    and the nearest sample refined between its neighbours to where the distance
    stops falling. FORMAT.md § Node."""

    def offset(s: Segment, t: float) -> tuple[float, float]:
        x, y = _point(s, t)
        return x - at.x, y - at.y

    best: tuple[int, Segment, float, float] | None = None
    best_d = math.inf
    for index, track in enumerate(tracks):
        for a, b in pairwise(track.nodes):
            s = segment(a, b)
            n = max(4, math.ceil(math.hypot(b.x - a.x, b.y - a.y) / _SAMPLE_PX))
            for k in range(n + 1):
                d = math.hypot(*offset(s, k / n))
                if d < best_d:
                    best, best_d = (index, s, k / n, 1 / n), d
    if best is None:
        return None

    # Bisect on the sign of the distance's slope, (P(t) − at) · P'(t).
    index, s, t, step = best
    lo, hi = max(0.0, t - step), min(1.0, t + step)
    for _ in range(60):
        mid = (lo + hi) / 2
        ox, oy = offset(s, mid)
        vx, vy = _derivative(s, mid)
        if ox * vx + oy * vy < 0:
            lo = mid
        else:
            hi = mid
    t = (lo + hi) / 2
    x, y = _point(s, t)
    return NearestPoint(
        track=index,
        point=Point(x=x, y=y),
        heading=heading_at(s, t),
        distance=math.hypot(x - at.x, y - at.y),
    )


def _point(s: Segment, t: float) -> tuple[float, float]:
    u = 1 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (
        a * s.p0.x + b * s.c0.x + c * s.c1.x + d * s.p1.x,
        a * s.p0.y + b * s.c0.y + c * s.c1.y + d * s.p1.y,
    )


def _derivative(s: Segment, t: float) -> tuple[float, float]:
    u = 1 - t
    a, b, c = u * u, 2 * u * t, t * t
    return (
        3 * (a * (s.c0.x - s.p0.x) + b * (s.c1.x - s.c0.x) + c * (s.p1.x - s.c1.x)),
        3 * (a * (s.c0.y - s.p0.y) + b * (s.c1.y - s.c0.y) + c * (s.p1.y - s.c1.y)),
    )
