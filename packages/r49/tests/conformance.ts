import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { ImageMismatch } from '../src/index.ts';
import { R49Archive, R49Error, getDPT, getDPTResidual } from './r49.ts';

/**
 * The TypeScript conformance runner: reads a case from `conformance/cases/`,
 * puts its input through this package, and says where the outcome and the
 * case's `expected.json` disagree. `conformance/README.md` defines a case; this
 * is one implementation of running one.
 */

/** A case's `expected.json`. */
export type Expected = { description?: string } & (
  | {
      result: 'accept';
      dpt?: number | null;
      residual?: number | null;
      tolerance?: number;
      image_mismatches?: ImageMismatch[];
    }
  | { result: 'reject'; rule: string }
);

/** What this package made of a case's input. */
export type Outcome =
  | { result: 'accept'; dpt: number | null; residual: number | null; imageMismatches: ImageMismatch[] }
  | { result: 'reject'; rule: string };

/** One case, read from its directory. */
export interface Case {
  name: string;
  input: { kind: 'archive' | 'manifest'; bytes: Uint8Array };
  expected: Expected;
}

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
  const inputs = (['archive', 'manifest'] as const).filter(kind => existsSync(join(dir, inputFile(kind))));
  if (inputs.length !== 1) {
    throw new Error(`case ${name}: holds ${inputs.length} of archive.r49 and manifest.json, not exactly one`);
  }
  const kind = inputs[0];
  return {
    name,
    input: { kind, bytes: new Uint8Array(readFileSync(join(dir, inputFile(kind)))) },
    expected: JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected,
  };
}

function inputFile(kind: 'archive' | 'manifest'): string {
  return kind === 'archive' ? 'archive.r49' : 'manifest.json';
}

/** Run a case's input through the package. */
export async function judge(input: Case['input']): Promise<Outcome> {
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
export function disagreements(expected: Expected, outcome: Outcome): string[] {
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
