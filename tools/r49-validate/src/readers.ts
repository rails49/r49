import { R49Archive, R49Error, getDPT, getDPTResidual, type ImageMismatch } from '@rails49/r49';
import type { ArchiveInput } from './validate.ts';

/**
 * Whether the Python package, `rails49-r49`, reads the corpus as the TypeScript
 * package does.
 *
 * The conformance cases show both agree on purpose-built inputs; this shows
 * they agree on the archives contributors actually sent. `read.py` beside this
 * package writes Python's outcomes as JSON, and `r49-validate readers` compares
 * them with TypeScript's, one archive at a time: accept or reject, the format
 * rule on reject, DPT and residual within {@link READER_TOLERANCE}, and the
 * image mismatches on accept.
 */

/** What one reader made of one archive. The shape `read.py` writes. */
export interface ReaderOutcome {
  readonly path: string;
  readonly result: 'accept' | 'reject';
  /** The format rule broken, on reject. */
  readonly rule: string | null;
  /** The fit's DPT and residual, on accept; null where they do not resolve. */
  readonly dpt: number | null;
  readonly residual: number | null;
  /** On accept, what the archive reports under `images/missing` and `images/orphan`. */
  readonly imageMismatches: readonly ImageMismatch[];
}

/** Absolute, on DPT and residual alike; the conformance cases' own tolerance. */
export const READER_TOLERANCE = 1e-9;

/**
 * What the TypeScript package makes of an archive. Anything thrown other than
 * an R49Error is a bug, not a verdict, and propagates.
 */
export async function readOutcome(input: ArchiveInput): Promise<ReaderOutcome> {
  let archive: R49Archive;
  try {
    archive = await R49Archive.load(input.bytes);
  } catch (err) {
    if (!(err instanceof R49Error)) throw err;
    return {
      path: input.path,
      result: 'reject',
      rule: err.rule,
      dpt: null,
      residual: null,
      imageMismatches: [],
    };
  }
  const manifest = archive.getManifest();
  return {
    path: input.path,
    result: 'accept',
    rule: null,
    dpt: getDPT(manifest),
    residual: getDPTResidual(manifest),
    imageMismatches: archive.imageMismatches(),
  };
}

/** Where two numbers that may each be null differ by more than the tolerance. */
function differs(a: number | null, b: number | null, tolerance: number): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > tolerance;
}

/** The image mismatches as one sorted string, equal for two lists in any order. */
function sortedMismatches(outcome: ReaderOutcome): string {
  return JSON.stringify(outcome.imageMismatches.map(m => `${m.rule} ${m.filename}`).sort());
}

function verdict(outcome: ReaderOutcome): string {
  return outcome.result === 'accept' ? 'accepts' : `rejects (${outcome.rule})`;
}

/** One line per archive the two readers disagree on, naming how; empty when they agree. */
export function readerDisagreements(
  typescript: readonly ReaderOutcome[],
  python: readonly ReaderOutcome[],
  tolerance: number = READER_TOLERANCE
): string[] {
  const lines: string[] = [];
  const byPath = new Map(python.map(outcome => [outcome.path, outcome]));

  for (const ts of typescript) {
    const py = byPath.get(ts.path);
    byPath.delete(ts.path);
    if (py === undefined) {
      lines.push(`${ts.path}: read by TypeScript, missing from Python's report`);
    } else if (ts.result !== py.result) {
      lines.push(`${ts.path}: TypeScript ${verdict(ts)}, Python ${verdict(py)}`);
    } else if (ts.result === 'reject') {
      if (ts.rule !== py.rule) {
        lines.push(`${ts.path}: TypeScript rejects under ${ts.rule}, Python under ${py.rule}`);
      }
    } else {
      if (differs(ts.dpt, py.dpt, tolerance)) {
        lines.push(`${ts.path}: DPT is ${ts.dpt} in TypeScript, ${py.dpt} in Python`);
      }
      if (differs(ts.residual, py.residual, tolerance)) {
        lines.push(`${ts.path}: residual is ${ts.residual} in TypeScript, ${py.residual} in Python`);
      }
      const [tsMismatches, pyMismatches] = [sortedMismatches(ts), sortedMismatches(py)];
      if (tsMismatches !== pyMismatches) {
        lines.push(
          `${ts.path}: image mismatches are ${tsMismatches} in TypeScript, ${pyMismatches} in Python`
        );
      }
    }
  }
  for (const path of byPath.keys()) {
    lines.push(`${path}: in Python's report, not read by TypeScript`);
  }

  return lines;
}
