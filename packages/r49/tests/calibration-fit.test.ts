import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { calibrationFit, getDPT, getDPTResidual } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

/**
 * The whole fit result: the pairs used, the points left out with the reason,
 * and whether the camera height fits. The DPT and residual of each arithmetic
 * case are in the conformance cases, `fit-*` and `height-*`.
 */

const cal = (px: [number, number], world: [number, number, number?]) => ({
  px: { x: px[0], y: px[1] },
  world: { x: world[0], y: world[1], z: world[2] ?? 0 },
});

function manifest(calibration: Record<string, unknown>): ManifestData {
  return {
    version: 4,
    layout: { name: 'Test Layout', scale: 'HO', calibration, sensors: [] },
    camera: { resolution: { width: 1920, height: 1080 } },
    images: [],
  } as unknown as ManifestData;
}

const dpt = (calibration: Record<string, unknown>) => getDPT(manifest(calibration));
const residual = (calibration: Record<string, unknown>) => getDPTResidual(manifest(calibration));
const fit = (calibration: Record<string, unknown>) => calibrationFit(manifest(calibration));

/** Two points 100 px apart over 10 mm, at height `z`: 10 px/mm as imaged. */
const plane = (z: number, px = 100, mm = 10) => [
  cal([0, 0], [0, 0, z]),
  cal([px, 0], [mm, 0, z]),
];

describe('calibrationFit', () => {
  it('names the pairs the fit used, normalized to layout zero', () => {
    // 100 px over 10 mm at z = 85 under a 1150 mm camera: (1150 − 85)/1150 of
    // the imaged separation is what the fit sees.
    const points = [...plane(0), ...plane(85)];
    const { pairs } = fit({ points, camera_height_mm: 1150 });
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ a: points[0], b: points[1], dPx: 100, dMm: 10 });
    expect(pairs[1].a).toBe(points[2]);
    expect(pairs[1].b).toBe(points[3]);
    expect(pairs[1].dPx).toBeCloseTo(100 * (1065 / 1150), 12);
    expect(pairs[1].dMm).toBe(10);
  });

  it('carries the DPT and residual getDPT and getDPTResidual report', () => {
    const points = [...plane(0), ...plane(85, 110)];
    const result = fit({ points, camera_height_mm: 1150, reference_height_mm: 85 });
    expect(result.dpt).toBeCloseTo(dpt({ points, camera_height_mm: 1150, reference_height_mm: 85 })!, 12);
    expect(result.residual).toBeGreaterThan(0);
    expect(result.residual).toBe(residual({ points, camera_height_mm: 1150, reference_height_mm: 85 }));
  });

  describe('leftOut', () => {
    const at = (z: number, x = 0) => cal([x, 0], [x, 0, z]);
    const reasons = (calibration: Record<string, unknown>) =>
      fit(calibration).leftOut.map(l => [l.point, l.reason]);

    it('names points off the reference plane when there is no camera height', () => {
      const points = [at(0), at(0, 10), at(85)];
      expect(reasons({ points })).toEqual([[points[2], 'off-reference-plane']]);
    });

    it('measures against the authored reference plane, not zero', () => {
      const points = [at(0), at(85), at(85, 10)];
      expect(reasons({ points, reference_height_mm: 85 })).toEqual([[points[0], 'off-reference-plane']]);
    });

    it('leaves nothing off the plane once a camera height makes every height usable', () => {
      const points = [at(0), at(0, 10), at(85), at(85, 10)];
      expect(reasons({ points, camera_height_mm: 1150 })).toEqual([]);
    });

    it('names points at or above the camera', () => {
      const points = [at(0), at(0, 10), at(1150), at(1200), at(1200, 10)];
      expect(reasons({ points, camera_height_mm: 1150 })).toEqual([
        [points[2], 'above-camera'],
        [points[3], 'above-camera'],
        [points[4], 'above-camera'],
      ]);
    });

    it('names a usable point no other point shares a height with', () => {
      const points = [at(0), at(0, 10), at(85)];
      expect(reasons({ points, camera_height_mm: 1150 })).toEqual([[points[2], 'no-partner']]);
      expect(reasons({ points: [at(0)] })).toEqual([[at(0), 'no-partner']]);
    });

    it('accounts for every point exactly once, in a pair or left out', () => {
      const points = [at(0), at(0, 10), at(85), at(1200)];
      const result = fit({ points, camera_height_mm: 1150 });
      const used = new Set(result.pairs.flatMap(p => [p.a, p.b]));
      const left = new Set(result.leftOut.map(l => l.point));
      expect(points.every(p => used.has(p) !== left.has(p))).toBe(true);
    });
  });

  describe('cameraHeightFits', () => {
    it('is null without a camera height', () => {
      expect(fit({ points: plane(0) }).cameraHeightFits).toBeNull();
    });

    it('holds when the camera is above every point', () => {
      expect(fit({ points: [...plane(0), ...plane(85)], camera_height_mm: 1150 }).cameraHeightFits).toBe(true);
    });

    it('holds with no points to compare against', () => {
      expect(fit({ points: [], camera_height_mm: 5 }).cameraHeightFits).toBe(true);
    });

    it('fails for a camera at or below any point, partnered or not', () => {
      // 115 for 1150, the decimal slip: one point at 230 mm is enough.
      expect(fit({ points: [cal([0, 0], [0, 0, 230])], camera_height_mm: 115 }).cameraHeightFits).toBe(false);
      expect(fit({ points: plane(500), camera_height_mm: 500 }).cameraHeightFits).toBe(false);
    });
  });

  it('reports no DPT and no residual for an empty calibration', () => {
    expect(fit({ points: [] })).toMatchObject({ dpt: null, residual: null, pairs: [], leftOut: [] });
  });
});

