import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { ImageMismatch, Point, Track } from '../src/index.ts';
import {
  R49Archive,
  R49Error,
  getDPT,
  getDPTResidual,
  headingAt,
  nearestOnTrack,
  pointAt,
  segment,
  wrapAngle,
} from './r49.ts';

/**
 * The TypeScript conformance runner: reads a case from `conformance/cases/`,
 * puts its input through this package, and says where the outcome and the
 * case's `expected.json` disagree. `conformance/README.md` defines a case; this
 * is one implementation of running one.
 */

/** A case's `expected.json`. */
export type Expected = ArchiveExpected | TrackExpected;

/** The `expected.json` of a case whose input is an archive or a manifest. */
export type ArchiveExpected = { description?: string } & (
  | {
      result: 'accept';
      dpt?: number | null;
      residual?: number | null;
      tolerance?: number;
      image_mismatches?: ImageMismatch[];
    }
  | { result: 'reject'; rule: string }
);

/** The `expected.json` of a case whose input is `track.json`. */
export interface TrackExpected {
  description?: string;
  points: { track: number; segment: number; t: number; x: number; y: number; heading: number }[];
  nearest: { at: Point; track: number; x: number; y: number; heading: number; distance: number }[];
  tolerance: number;
}

/** What this package made of a case's input. */
export type Outcome =
  | { result: 'accept'; dpt: number | null; residual: number | null; imageMismatches: ImageMismatch[] }
  | { result: 'reject'; rule: string };

/** One case, read from its directory. */
export type Case =
  | { name: string; input: { kind: 'archive' | 'manifest'; bytes: Uint8Array }; expected: ArchiveExpected }
  | { name: string; input: { kind: 'track'; tracks: Track[] }; expected: TrackExpected };

type InputKind = Case['input']['kind'];

/** Every case under `root`, in name order. */
export function readCases(root: string): Case[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .map(name => readCase(root, name));
}

/** @throws If the directory does not hold exactly one input and an `expected.json`. */
export function readCase(root: string, name: string): Case {
  const dir = join(root, name);
  const inputs = (['archive', 'manifest', 'track'] as const).filter(kind => existsSync(join(dir, INPUT_FILE[kind])));
  if (inputs.length !== 1) {
    throw new Error(`case ${name}: holds ${inputs.length} of archive.r49, manifest.json and track.json, not exactly one`);
  }
  const kind = inputs[0];
  const bytes = new Uint8Array(readFileSync(join(dir, INPUT_FILE[kind])));
  const expected: unknown = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  if (kind === 'track') {
    const { tracks } = JSON.parse(new TextDecoder().decode(bytes)) as { tracks: Track[] };
    return { name, input: { kind, tracks }, expected: expected as TrackExpected };
  }
  return { name, input: { kind, bytes }, expected: expected as ArchiveExpected };
}

const INPUT_FILE: Record<InputKind, string> = {
  archive: 'archive.r49',
  manifest: 'manifest.json',
  track: 'track.json',
};

/** Run an archive or manifest case's input through the package. */
export async function judge(input: { kind: 'archive' | 'manifest'; bytes: Uint8Array }): Promise<Outcome> {
  const bytes = input.kind === 'archive' ? input.bytes : await wrapManifest(input.bytes);
  return await judgeArchive(bytes);
}

/**
 * Load archive bytes and report the outcome. A refusal is an R49Error; anything
 * else thrown is a bug in the package, not a verdict, and propagates.
 */
export async function judgeArchive(bytes: Uint8Array): Promise<Outcome> {
  let archive: InstanceType<typeof R49Archive>;
  try {
    archive = await R49Archive.load(bytes);
  } catch (err) {
    if (err instanceof R49Error) return { result: 'reject', rule: err.rule };
    throw err;
  }
  const manifest = archive.getManifest();
  return {
    result: 'accept',
    dpt: getDPT(manifest),
    residual: getDPTResidual(manifest),
    imageMismatches: archive.imageMismatches(),
  };
}

/**
 * This package parses manifests only inside an archive, so a bare manifest is
 * zipped as `manifest.json` beside a placeholder for every image it names —
 * which keeps `images/missing` and `images/orphan`, the rules a bare manifest
 * is exempt from, out of the verdict. The names are read leniently: if the
 * bytes are not JSON there are no placeholders, and the package refuses the
 * manifest before it looks at images.
 */
async function wrapManifest(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('manifest.json', bytes);
  for (const filename of namedImages(bytes)) {
    if (filename !== 'manifest.json') zip.file(filename, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  }
  return await zip.generateAsync({ type: 'uint8array' });
}

function namedImages(bytes: Uint8Array): string[] {
  try {
    const images = JSON.parse(new TextDecoder().decode(bytes))?.images;
    if (!Array.isArray(images)) return [];
    return images.map(image => image?.filename).filter((f): f is string => typeof f === 'string' && f !== '');
  } catch {
    return [];
  }
}

/**
 * Where `outcome` disagrees with `expected`, one line each; empty when it
 * agrees. A `dpt` or `residual` absent from `expected` is not checked; `null`
 * must be `null`; a number must be within `tolerance` of the outcome. The image
 * mismatches must be `image_mismatches`, in any order; absent, there are none.
 */
export function disagreements(expected: ArchiveExpected, outcome: Outcome): string[] {
  if (expected.result !== outcome.result) {
    const got = outcome.result === 'reject' ? `reject (${outcome.rule})` : 'accept';
    return [`expected ${expected.result}, got ${got}`];
  }
  if (expected.result === 'reject' && outcome.result === 'reject') {
    return expected.rule === outcome.rule ? [] : [`expected rule ${expected.rule}, got ${outcome.rule}`];
  }
  if (expected.result !== 'accept' || outcome.result !== 'accept') return [];

  const found: string[] = [];
  for (const key of ['dpt', 'residual'] as const) {
    const want = expected[key];
    const got = outcome[key];
    if (want === undefined) continue;
    if (want === null || got === null) {
      if (want !== got) found.push(`expected ${key} ${want}, got ${got}`);
      continue;
    }
    if (expected.tolerance === undefined) {
      found.push(`${key} is a number, so expected.json needs a tolerance`);
    } else if (!(Math.abs(got - want) <= expected.tolerance)) {
      found.push(`expected ${key} ${want} ± ${expected.tolerance}, got ${got}`);
    }
  }
  const want = sortedMismatches(expected.image_mismatches ?? []);
  const got = sortedMismatches(outcome.imageMismatches);
  if (want !== got) found.push(`expected image mismatches ${want}, got ${got}`);
  return found;
}

function sortedMismatches(mismatches: readonly ImageMismatch[]): string {
  return JSON.stringify(mismatches.map(m => `${m.rule} ${m.filename}`).sort());
}

/**
 * Where this package's curve through `tracks` disagrees with a track case's
 * `expected`, one line each; empty when it agrees. Each coordinate and
 * distance must be within `tolerance`; each heading must be in (−π, π] and
 * within `tolerance` of the expected direction, modulo 2π.
 */
export function trackDisagreements(tracks: readonly Track[], expected: TrackExpected): string[] {
  const found: string[] = [];
  const near = (what: string, got: number, want: number) => {
    if (!(Math.abs(got - want) <= expected.tolerance)) found.push(`${what}: expected ${want} ± ${expected.tolerance}, got ${got}`);
  };
  const heading = (what: string, got: number, want: number) => {
    if (!(got > -Math.PI && got <= Math.PI)) found.push(`${what}: heading ${got} is outside (−π, π]`);
    else if (!(Math.abs(wrapAngle(got - want)) <= expected.tolerance)) {
      found.push(`${what}: expected heading ${want} ± ${expected.tolerance}, got ${got}`);
    }
  };
  for (const p of expected.points) {
    const what = `track ${p.track} segment ${p.segment} t ${p.t}`;
    const nodes = tracks[p.track].nodes;
    const s = segment(nodes[p.segment], nodes[p.segment + 1]);
    const at = pointAt(s, p.t);
    near(`${what} x`, at.x, p.x);
    near(`${what} y`, at.y, p.y);
    heading(what, headingAt(s, p.t), p.heading);
  }
  for (const n of expected.nearest) {
    const what = `nearest (${n.at.x}, ${n.at.y})`;
    const got = nearestOnTrack(tracks, n.at);
    if (got === null) {
      found.push(`${what}: expected a point, got null`);
      continue;
    }
    if (got.track !== n.track) found.push(`${what}: expected track ${n.track}, got ${got.track}`);
    near(`${what} x`, got.point.x, n.x);
    near(`${what} y`, got.point.y, n.y);
    near(`${what} distance`, got.distance, n.distance);
    heading(what, got.heading, n.heading);
  }
  return found;
}
