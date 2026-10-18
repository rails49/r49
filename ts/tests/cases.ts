import { expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { R49Archive, calibrationFit } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

/**
 * Reading the conformance cases, shared by the conformance and writer tests.
 * FORMAT.md § Conformance cases defines what each case directory holds.
 */

export const CASES =
  process.env.R49_CONFORMANCE ?? fileURLToPath(new URL('../../conformance', import.meta.url));

export interface Expected {
  readonly accept: boolean;
  readonly rule?: string;
  readonly id?: string;
  readonly fit?: {
    readonly dpt: number | null;
    readonly residual: number | null;
    readonly pairs: readonly (readonly [number, number])[];
    readonly left_out: readonly { point: number; reason: string }[];
    readonly camera_height_fits: boolean | null;
    readonly tolerance: number;
  };
}

export function cases(): { name: string; dir: string; expected: Expected }[] {
  return readdirSync(CASES)
    .filter(name => existsSync(join(CASES, name, 'expected.json')))
    .sort()
    .map(name => ({
      name,
      dir: join(CASES, name),
      expected: JSON.parse(readFileSync(join(CASES, name, 'expected.json'), 'utf8')),
    }));
}

/** A case's manifest: an archive is loaded, a bare manifest set. Both validate. */
export async function loadCase(dir: string): Promise<ManifestData> {
  const archive = join(dir, 'archive.r49');
  if (existsSync(archive)) {
    return (await R49Archive.load(readFileSync(archive))).getManifest();
  }
  const r49 = new R49Archive();
  r49.setManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  return r49.getManifest();
}

/** Assert a manifest's fit and id against what a case expects. */
export function expectMatches(manifest: ManifestData, expected: Expected): void {
  if (expected.id !== undefined) expect(manifest.id).toBe(expected.id);
  const want = expected.fit;
  if (want === undefined) return;

  const fit = calibrationFit(manifest);
  const close = (actual: number | null, wanted: number | null) => {
    if (actual === null || wanted === null) expect(actual).toBe(wanted);
    else expect(Math.abs(actual - wanted)).toBeLessThanOrEqual(want.tolerance);
  };
  close(fit.dpt, want.dpt);
  close(fit.residual, want.residual);
  expect(fit.pairs.map(p => [p.a, p.b])).toEqual(want.pairs);
  expect(fit.leftOut).toEqual(want.left_out);
  expect(fit.cameraHeightFits).toBe(want.camera_height_fits);
}
