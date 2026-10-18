import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { readerDisagreements, readOutcome, type ReaderOutcome } from '../src/readers.ts';

const FIXTURE = 'fixtures/simple.r49';
const fixtureBytes = () => readFileSync(new URL(`../../../${FIXTURE}`, import.meta.url));

const accept = (over: Partial<ReaderOutcome> = {}): ReaderOutcome => ({
  path: FIXTURE,
  result: 'accept',
  rule: null,
  dpt: 18,
  residual: 0.5,
  ...over,
});

describe('what the TypeScript package makes of an archive', () => {
  it('accepts a fixture with its DPT and residual', async () => {
    const outcome = await readOutcome({ path: FIXTURE, bytes: fixtureBytes() });
    expect(outcome.result).toBe('accept');
    expect(outcome.rule).toBeNull();
    expect(outcome.dpt).toBeCloseTo(18.0, 1);
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
    });
  });
});

describe('comparing the two readers', () => {
  it('finds nothing when they agree within the tolerance', () => {
    expect(readerDisagreements([accept()], [accept({ dpt: 18 + 1e-12 })])).toEqual([]);
  });

  it('names an archive one accepts and the other rejects', () => {
    const python = accept({ result: 'reject', rule: 'manifest/schema', dpt: null, residual: null });
    expect(readerDisagreements([accept()], [python])).toEqual([
      `${FIXTURE}: TypeScript accepts, Python rejects (manifest/schema)`,
    ]);
  });

  it('names a different rule on reject', () => {
    const reject = (rule: string) =>
      accept({ result: 'reject', rule, dpt: null, residual: null });
    expect(readerDisagreements([reject('archive/not-zip')], [reject('archive/no-manifest')])).toEqual([
      `${FIXTURE}: TypeScript rejects under archive/not-zip, Python under archive/no-manifest`,
    ]);
  });

  it('names a DPT or residual outside the tolerance, or null on one side only', () => {
    expect(readerDisagreements([accept()], [accept({ dpt: 18.001 })])).toEqual([
      `${FIXTURE}: DPT is 18 in TypeScript, 18.001 in Python`,
    ]);
    expect(readerDisagreements([accept()], [accept({ residual: null })])).toEqual([
      `${FIXTURE}: residual is 0.5 in TypeScript, null in Python`,
    ]);
  });

  it('names an archive only one reader reported', () => {
    expect(readerDisagreements([accept()], [])).toEqual([
      `${FIXTURE}: read by TypeScript, missing from Python's report`,
    ]);
    expect(readerDisagreements([], [accept()])).toEqual([
      `${FIXTURE}: in Python's report, not read by TypeScript`,
    ]);
  });
});
