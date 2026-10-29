import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { readerDisagreements, readOutcome, type ReaderOutcome } from '../src/readers.ts';

// A conformance case, so the test does not depend on what the corpus holds.
const CASE = 'conformance/cases/format-v4/archive.r49';
const caseBytes = () => readFileSync(new URL(`../../../${CASE}`, import.meta.url));

const accept = (over: Partial<ReaderOutcome> = {}): ReaderOutcome => ({
  path: CASE,
  result: 'accept',
  rule: null,
  dpt: 18,
  residual: 0.5,
  imageMismatches: [],
  ...over,
});

describe('what the TypeScript package makes of an archive', () => {
  it('accepts an archive with its DPT and residual', async () => {
    const outcome = await readOutcome({ path: CASE, bytes: caseBytes() });
    expect(outcome.result).toBe('accept');
    expect(outcome.rule).toBeNull();
    expect(outcome.dpt).toBeCloseTo(16.5885, 3);
    expect(outcome.residual).toBeCloseTo(5.3452, 3);
  });

  it('rejects with the format rule broken, and no fit', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', '{');
    const outcome = await readOutcome({
      path: 'archives/alice/bad.r49',
      bytes: await zip.generateAsync({ type: 'uint8array' }),
    });
    expect(outcome).toEqual({
      path: 'archives/alice/bad.r49',
      result: 'reject',
      rule: 'manifest/not-json',
      dpt: null,
      residual: null,
      imageMismatches: [],
    });
  });

  it('accepts an archive with a stray image and reports it', async () => {
    const zip = await JSZip.loadAsync(caseBytes());
    zip.file('stray.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const outcome = await readOutcome({
      path: CASE,
      bytes: await zip.generateAsync({ type: 'uint8array' }),
    });
    expect(outcome.result).toBe('accept');
    expect(outcome.imageMismatches).toEqual([{ rule: 'images/orphan', filename: 'stray.jpg' }]);
  });
});

describe('comparing the two readers', () => {
  it('finds nothing when they agree within the tolerance', () => {
    expect(readerDisagreements([accept()], [accept({ dpt: 18 + 1e-12 })])).toEqual([]);
  });

  it('names an archive one accepts and the other rejects', () => {
    const python = accept({ result: 'reject', rule: 'manifest/schema', dpt: null, residual: null });
    expect(readerDisagreements([accept()], [python])).toEqual([
      `${CASE}: TypeScript accepts, Python rejects (manifest/schema)`,
    ]);
  });

  it('names a different rule on reject', () => {
    const reject = (rule: string) =>
      accept({ result: 'reject', rule, dpt: null, residual: null });
    expect(readerDisagreements([reject('archive/not-zip')], [reject('archive/no-manifest')])).toEqual([
      `${CASE}: TypeScript rejects under archive/not-zip, Python under archive/no-manifest`,
    ]);
  });

  it('names a DPT or residual outside the tolerance, or null on one side only', () => {
    expect(readerDisagreements([accept()], [accept({ dpt: 18.001 })])).toEqual([
      `${CASE}: DPT is 18 in TypeScript, 18.001 in Python`,
    ]);
    expect(readerDisagreements([accept()], [accept({ residual: null })])).toEqual([
      `${CASE}: residual is 0.5 in TypeScript, null in Python`,
    ]);
  });

  it('names image mismatches that differ, in any order', () => {
    const missing = { rule: 'images/missing', filename: 'a.jpg' } as const;
    const orphan = { rule: 'images/orphan', filename: 'b.jpg' } as const;
    const typescript = accept({ imageMismatches: [missing, orphan] });
    const python = accept({ imageMismatches: [orphan, missing] });
    expect(readerDisagreements([typescript], [python])).toEqual([]);
    expect(readerDisagreements([accept({ imageMismatches: [orphan] })], [accept()])).toEqual([
      `${CASE}: image mismatches are ["images/orphan b.jpg"] in TypeScript, [] in Python`,
    ]);
  });

  it('names an archive only one reader reported', () => {
    expect(readerDisagreements([accept()], [])).toEqual([
      `${CASE}: read by TypeScript, missing from Python's report`,
    ]);
    expect(readerDisagreements([], [accept()])).toEqual([
      `${CASE}: in Python's report, not read by TypeScript`,
    ]);
  });
});
