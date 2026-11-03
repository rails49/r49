import type { Point, Track, TrackNode } from './manifest.schema.ts';

/**
 * The cubic Bézier between two consecutive nodes of a track: from `p0` to
 * `p1`, with control points `c0` and `c1`. FORMAT.md § Node defines it.
 */
export interface Segment {
  readonly p0: Point;
  readonly c0: Point;
  readonly c1: Point;
  readonly p1: Point;
}

/** The point on a set of tracks nearest a given one, from {@link nearestOnTrack}. */
export interface NearestPoint {
  /** The index of the track the point is on. */
  readonly track: number;
  readonly point: Point;
  /** The direction the track runs at the point, in radians, in (−π, π]. */
  readonly heading: number;
  /** From the given point to `point`, in image pixels. */
  readonly distance: number;
}

/**
 * `angle`, in radians, brought into (−π, π]. Any finite number goes in;
 * angles that differ by a multiple of 2π come out the same.
 */
export function wrapAngle(angle: number): number {
  const wrapped = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * The curve from node `a` to node `b`, as FORMAT.md § Node defines it: each
 * control point lies along its node's heading, at `d / (3 · cos²(φ / 4))`,
 * with `d` the distance from `a` to `b` and `φ` the turn brought into (−π, π].
 */
export function segment(a: TrackNode, b: TrackNode): Segment {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const h = d / (3 * Math.cos(wrapAngle(b.heading - a.heading) / 4) ** 2);
  return {
    p0: { x: a.x, y: a.y },
    c0: { x: a.x + h * Math.cos(a.heading), y: a.y + h * Math.sin(a.heading) },
    c1: { x: b.x - h * Math.cos(b.heading), y: b.y - h * Math.sin(b.heading) },
    p1: { x: b.x, y: b.y },
  };
}

/** The point on `s` at `t` in [0, 1]: `p0` at 0, `p1` at 1. FORMAT.md § Node. */
export function pointAt(s: Segment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c0.x + c * s.c1.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c0.y + c * s.c1.y + d * s.p1.y,
  };
}

/**
 * The direction `s` runs at `t` in [0, 1], in radians, in (−π, π]: the
 * direction of the curve's derivative. FORMAT.md § Node.
 */
export function headingAt(s: Segment, t: number): number {
  const v = derivativeAt(s, t);
  return wrapAngle(Math.atan2(v.y, v.x));
}

/**
 * The point on `tracks` nearest `at`, at any distance, or null when there are
 * no tracks. Each segment is sampled every couple of image pixels, and the
 * nearest sample refined between its neighbours to where the distance stops
 * falling.
 */
export function nearestOnTrack(tracks: readonly Track[], at: Point): NearestPoint | null {
  const offset = (s: Segment, t: number) => {
    const p = pointAt(s, t);
    return { x: p.x - at.x, y: p.y - at.y };
  };
  let best: { track: number; s: Segment; t: number; step: number } | null = null;
  let bestD = Infinity;
  for (const [track, { nodes }] of tracks.entries()) {
    for (let i = 1; i < nodes.length; i++) {
      const s = segment(nodes[i - 1], nodes[i]);
      const n = Math.max(4, Math.ceil(Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) / SAMPLE_PX));
      for (let k = 0; k <= n; k++) {
        const o = offset(s, k / n);
        const d = Math.hypot(o.x, o.y);
        if (d < bestD) {
          best = { track, s, t: k / n, step: 1 / n };
          bestD = d;
        }
      }
    }
  }
  if (!best) return null;

  // Bisect on the sign of the distance's slope, (P(t) − at) · P'(t).
  const { track, s } = best;
  let lo = Math.max(0, best.t - best.step);
  let hi = Math.min(1, best.t + best.step);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const o = offset(s, mid);
    const v = derivativeAt(s, mid);
    if (o.x * v.x + o.y * v.y < 0) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const point = pointAt(s, t);
  return { track, point, heading: headingAt(s, t), distance: Math.hypot(point.x - at.x, point.y - at.y) };
}

/** Spacing, in image pixels, of the samples `nearestOnTrack` starts from. */
const SAMPLE_PX = 2;

function derivativeAt(s: Segment, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * (u * u * (s.c0.x - s.p0.x) + 2 * u * t * (s.c1.x - s.c0.x) + t * t * (s.p1.x - s.c1.x)),
    y: 3 * (u * u * (s.c0.y - s.p0.y) + 2 * u * t * (s.c1.y - s.c0.y) + t * t * (s.p1.y - s.c1.y)),
  };
}
