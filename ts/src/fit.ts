import { getGaugeMM } from './data.ts';
import type { ManifestData } from './manifest.schema.ts';

/** Why a reference point entered no pair. The first that applies is the one given. */
export type LeftOutReason = 'off-reference-plane' | 'above-camera' | 'no-partner';

/** One equal-height pair of reference points, as the two separations the fit sees. */
export interface CalibrationPair {
  /** Index of the first point in `layout.calibration.points`. */
  readonly a: number;
  /** Index of the second point; always greater than `a`. */
  readonly b: number;
  /** Separation in image pixels, normalized to layout zero when the camera height is known. */
  readonly dPx: number;
  /** Separation on the layout, in mm. */
  readonly dMm: number;
}

/** A reference point the fit did not use, and why. */
export interface LeftOutPoint {
  readonly point: number;
  readonly reason: LeftOutReason;
}

/**
 * Everything the calibration says, computed once — FORMAT.md § The calibration
 * fit. The editor, the validator and an outside reader all read this one
 * result, so "does not resolve" means the same thing in each (occupancy #171).
 */
export interface CalibrationFit {
  /** DPT on the reference plane, or `null` when calibration does not resolve. */
  readonly dpt: number | null;
  /** RMS disagreement with the fitted scale, in image pixels; `null` below two pairs. */
  readonly residual: number | null;
  readonly pairs: readonly CalibrationPair[];
  readonly leftOut: readonly LeftOutPoint[];
  /** Whether the camera clears the reference plane and every point; `null` without a height. */
  readonly cameraHeightFits: boolean | null;
}

/**
 * The calibration fit: a least-squares scale over equal-height pairs,
 * normalized to layout zero by the camera height and reported at the reference
 * plane, converted to track widths.
 *
 * ```
 * pairs = { (i,j) : z_i == z_j,  i < j,  neither point left out }
 * d_px' = d_px · (h − z)/h                      // camera height known
 * s     = Σ(d_px' · d_mm) / Σ(d_mm²)   over pairs
 * DPT   = s · gauge_mm(scale) · h/(h − z_ref)
 * ```
 *
 * **Why a height at all.** Under a pinhole camera at height `h` every length at
 * height `z` images `z/(h−z)` too large — 9.3% at track height under a 1 m
 * camera. `h` removes it in closed form; focal length cannot, because it
 * cancels from the ratio. See ADR 0002.
 *
 * **A pair still needs one height.** Two points at different heights sit at
 * different depths *and* azimuths, so their pixel separation is not any scale
 * times any distance. What the height changes is that pairs at *different*
 * heights combine correctly into one fit, each normalized to layout zero.
 *
 * **Absent `h` the fit restricts to the reference plane**, and points off it are
 * left out as `off-reference-plane`: stored, but inert. `z` equality is exact:
 * the values are typed by hand.
 *
 * The `d_mm²` weighting favours long baselines, which is the right bias: click
 * error is a fixed number of pixels, so short baselines are proportionally
 * noisier.
 *
 * The residual uses the same pairs with the same normalization, which is what
 * makes it validate the camera height for free: a wrong `h` normalizes pairs at
 * different heights inconsistently, and the residual rises. It is blind when
 * every point shares one height, and it is a cross-check, never a gate. It is
 * `null` below two pairs because one pair reproduces itself exactly.
 */
export function calibrationFit(manifest: ManifestData): CalibrationFit {
  const { calibration } = manifest.layout;
  const { points } = calibration;
  const h = calibration.camera_height_mm;
  const zRef = calibration.reference_height_mm ?? 0;

  const reasons = new Map<number, LeftOutReason>();
  points.forEach((p, i) => {
    // Without a camera height, only the named plane can be spoken about.
    if (h === undefined && p.world.z !== zRef) reasons.set(i, 'off-reference-plane');
    // A point at or above the camera is not a pose the pinhole model has.
    else if (h !== undefined && p.world.z >= h) reasons.set(i, 'above-camera');
  });

  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (reasons.has(i) || reasons.has(j) || a.world.z !== b.world.z) continue;

      const dPx = Math.hypot(a.px.x - b.px.x, a.px.y - b.px.y);
      pairs.push({
        a: i,
        b: j,
        dPx: h === undefined ? dPx : dPx * ((h - a.world.z) / h),
        dMm: Math.hypot(a.world.x - b.world.x, a.world.y - b.world.y),
      });
    }
  }

  const paired = new Set(pairs.flatMap(p => [p.a, p.b]));
  points.forEach((_, i) => {
    if (!reasons.has(i) && !paired.has(i)) reasons.set(i, 'no-partner');
  });

  // Zero-separation pairs contribute nothing to either sum, so coincident
  // points land on a zero denominator rather than dividing by zero.
  let numerator = 0;
  let denominator = 0;
  for (const { dPx, dMm } of pairs) {
    numerator += dPx * dMm;
    denominator += dMm * dMm;
  }
  const scale = denominator === 0 ? null : numerator / denominator;

  let dpt: number | null = null;
  // A reference plane at or above the camera is incoherent geometry.
  if (scale !== null && (h === undefined || h > zRef)) {
    // Absent `h` the fit already sits on the reference plane; with it, the fit
    // is at layout zero and this lifts it to where the track is.
    const atReference = h === undefined ? scale : scale * (h / (h - zRef));
    dpt = atReference * getGaugeMM(manifest.layout.scale);
  }

  let residual: number | null = null;
  if (scale !== null && pairs.length >= 2) {
    let sumSq = 0;
    for (const { dPx, dMm } of pairs) sumSq += (dPx - scale * dMm) ** 2;
    residual = Math.sqrt(sumSq / pairs.length);
  }

  const cameraHeightFits =
    h === undefined ? null : h > zRef && points.every(p => h > p.world.z);

  return {
    dpt,
    residual,
    pairs,
    leftOut: [...reasons]
      .sort(([a], [b]) => a - b)
      .map(([point, reason]) => ({ point, reason })),
    cameraHeightFits,
  };
}

/** DPT, read from {@link calibrationFit}. `null` means "cannot answer", not zero. */
export function getDPT(manifest: ManifestData): number | null {
  return calibrationFit(manifest).dpt;
}

/** The fit residual in image pixels, read from {@link calibrationFit}. */
export function getDPTResidual(manifest: ManifestData): number | null {
  return calibrationFit(manifest).residual;
}
