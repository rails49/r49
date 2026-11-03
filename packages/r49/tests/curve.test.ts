import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { headingAt, nearestOnTrack, pointAt, segment, wrapAngle } from '../src/index.ts';

/**
 * The curve between two nodes (FORMAT.md § Node), and the nearest point on a
 * track. The closed-form values every reader agrees on are the conformance
 * cases, `curve-*` and `nearest-*`; these are the properties around them.
 */

describe('wrapAngle', () => {
  it('maps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(-5 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('segment', () => {
  it('leaves each node along its heading', () => {
    const s = segment({ x: 0, y: 0, heading: 0.3 }, { x: 200, y: 80, heading: 0.5 + 2 * Math.PI });
    expect(headingAt(s, 0)).toBeCloseTo(0.3, 12);
    expect(headingAt(s, 1)).toBeCloseTo(0.5, 12);
  });

  it('stays within 0.03 % of the circular arc, for headings symmetric about the chord and turns up to 90°', () => {
    // The arc of radius 100 about the origin, from angle -turn/2 to +turn/2.
    for (const turn of [0.1, 0.5, 1, Math.PI / 4, Math.PI / 2]) {
      const end = (a: number) => ({ x: 100 * Math.cos(a), y: 100 * Math.sin(a), heading: a + Math.PI / 2 });
      const s = segment(end(-turn / 2), end(turn / 2));
      for (let k = 0; k <= 100; k++) {
        const p = pointAt(s, k / 100);
        expect(Math.abs(Math.hypot(p.x, p.y) - 100)).toBeLessThan(0.03);
      }
    }
  });
});

describe('nearestOnTrack', () => {
  it('finds nothing on no tracks', () => {
    expect(nearestOnTrack([], { x: 0, y: 0 })).toBeNull();
  });
});
