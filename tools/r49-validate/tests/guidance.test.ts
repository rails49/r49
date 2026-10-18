import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { readFileSync } from 'node:fs';
import { VALID_SCALES } from '@rails49/r49';
import {
  checkGuidance,
  extractGeneratedBlock,
  gaugeMM,
  guidanceTable,
  GUIDANCE_COMMAND,
  maxFrameMM,
  RECOMMENDED_DPT,
  REFERENCE_WIDTH_PX,
} from '../src/guidance.ts';

/** A CONTRIBUTING.md shaped like the corpus's, wrapped around whatever block. */
function document(block: string): string {
  return [
    '# Contributing',
    '',
    'The widest strip of track that may span one frame:',
    '',
    '<!-- BEGIN GENERATED — do not edit by hand.',
    '     Produced at the root of this repository by:',
    `       ${GUIDANCE_COMMAND}`,
    '     CI diffs this block against that command output. -->',
    '',
    block,
    '',
    '<!-- END GENERATED -->',
    '',
    'So for HO: about 1.6 m of track in frame.',
  ].join('\n');
}

describe('capture guidance', () => {
  it('derives the frame width from the same arithmetic getDPT uses', () => {
    // DPT = px_per_mm × gauge_mm, so the widest frame that still reaches
    // the recommended DPT is width_px × gauge_mm / RECOMMENDED_DPT. Asserted
    // against the identity rather than against a number, so a change to the
    // recommended DPT moves both sides.
    for (const scale of VALID_SCALES) {
      const frameMM = maxFrameMM(scale, 1920);
      expect((1920 / frameMM) * gaugeMM(scale)).toBeCloseTo(RECOMMENDED_DPT, 10);
    }
  });

  it('scales linearly with image width', () => {
    expect(maxFrameMM('HO', 3840)).toBeCloseTo(maxFrameMM('HO', 1920) * 2, 10);
  });

  it('states the reference width, because it is an input and not a constant', () => {
    expect(guidanceTable(1920)).toContain('1920 px');
    expect(guidanceTable(4032)).toContain('4032 px');
  });

  it('names the recommended DPT the numbers were computed against', () => {
    expect(guidanceTable()).toContain(`**${RECOMMENDED_DPT}**`);
  });

  it('reads the recommended DPT from data.json, where it is 20', () => {
    expect(RECOMMENDED_DPT).toBe(20);
  });

  it('emits one row per scale, in the order data.json defines them', () => {
    const rows = guidanceTable()
      .split('\n')
      .filter(line => line.startsWith('| ') && !line.startsWith('| Scale') && !line.startsWith('| :'));

    expect(rows).toHaveLength(VALID_SCALES.length);
    expect(rows.map(row => row.split('|')[1].trim())).toEqual([...VALID_SCALES]);
  });

  it('is byte-identical across calls, since CI diffs it against committed prose', () => {
    expect(guidanceTable()).toBe(guidanceTable());
    expect(guidanceTable()).toBe(guidanceTable(REFERENCE_WIDTH_PX));
  });

  it('rounds to fixed precision rather than printing raw floats', () => {
    // A diff against prose is only useful when the output is deterministic —
    // and 16.494252873563218 mm would change with any refactor of the maths.
    expect(guidanceTable()).toContain('16.49 mm');
    expect(guidanceTable()).not.toMatch(/\d\.\d{4}/);
  });
});

describe('the generated block', () => {
  it('is read out from between the markers, ignoring the padding around them', () => {
    expect(extractGeneratedBlock(document(guidanceTable()))).toBe(guidanceTable());
  });

  it('survives a CRLF checkout and trailing whitespace', () => {
    const crlf = document(guidanceTable()).replace(/\n/g, ' \r\n');
    expect(checkGuidance(crlf).ok).toBe(true);
  });

  it('is absent when a marker is missing, deleted or reversed', () => {
    const block = guidanceTable();
    expect(extractGeneratedBlock(`no markers at all\n${block}`)).toBeNull();
    expect(
      extractGeneratedBlock(document(block).replace('<!-- END GENERATED -->', ''))
    ).toBeNull();
    expect(extractGeneratedBlock('<!-- END GENERATED -->\n<!-- BEGIN GENERATED -->')).toBeNull();
  });

  it('passes the table it was generated from, at any width', () => {
    expect(checkGuidance(document(guidanceTable())).ok).toBe(true);
    expect(checkGuidance(document(guidanceTable(4032)), 4032).ok).toBe(true);
  });

  it('fails a table generated for a different width', () => {
    // The stand-in for the real failure: the recommended DPT moving in
    // data.json while CONTRIBUTING.md still carries the old numbers. Width is
    // the input a test can move.
    expect(checkGuidance(document(guidanceTable(4032))).ok).toBe(false);
  });

  it('fails a hand-edited row, which is the whole point of diffing prose', () => {
    const tampered = guidanceTable().replace('16.49 mm', '16.50 mm');
    expect(checkGuidance(document(tampered)).ok).toBe(false);
  });

  it('tells a contributor the failure is probably not theirs, and how to fix it', () => {
    // The message is the deliverable here: the usual cause is a change to a
    // file the person reading it has never touched.
    const { message } = checkGuidance(document(guidanceTable(4032)));
    expect(message).toContain('not about your submission');
    expect(message).toContain('recommended_dpt');
    expect(message).toContain('packages/r49/src/data.json');
    expect(message).toContain('pnpm --silent --filter @rails49/r49-validate guidance');
    expect(message).toContain('CONTRIBUTING.md');
  });

  it('offers the block to paste when the markers are gone', () => {
    const { ok, message } = checkGuidance('# Contributing\n\nnothing generated here.\n');
    expect(ok).toBe(false);
    expect(message).toContain(guidanceTable());
  });
});

describe("this repository's CONTRIBUTING.md", () => {
  it('carries the table the recommended DPT produces', () => {
    // The recommended DPT took over from rails49/occupancy's min_dpt at the
    // same value, so the committed table did not move.
    const contributing = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8');
    expect(checkGuidance(contributing)).toEqual({
      ok: true,
      message: 'The capture-guidance table is up to date.',
    });
  });
});
