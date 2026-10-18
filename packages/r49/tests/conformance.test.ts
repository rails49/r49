import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FORMAT_RULE_IDS, R49Archive, getDPT, getDPTResidual } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';
import { disagreements, judge, judgeArchive, readCases } from './conformance.ts';

/**
 * Every case in `conformance/cases/`, run through this package. Cases assert
 * an outcome — accept or reject, the rule id, DPT and residual — and never a
 * message: the id is the contract, the wording is not.
 */

const CASES = fileURLToPath(new URL('../../../conformance/cases/', import.meta.url));
const cases = readCases(CASES);

describe('conformance cases', () => {
  for (const c of cases) {
    it(c.name, async () => {
      expect(disagreements(c.expected, await judge(c.input))).toEqual([]);
    });
  }

  it('reject every format rule id at least once', () => {
    const rejected = new Set(cases.flatMap(c => (c.expected.result === 'reject' ? [c.expected.rule] : [])));
    expect(FORMAT_RULE_IDS.filter(rule => !rejected.has(rule))).toEqual([]);
  });

  it('name only format rule ids', () => {
    const known = new Set<string>(FORMAT_RULE_IDS);
    const unknown = cases.filter(c => c.expected.result === 'reject' && !known.has(c.expected.rule));
    expect(unknown.map(c => c.name)).toEqual([]);
  });
});

/**
 * The writer's side of the contract: whatever `export()` writes is an archive
 * every reader accepts, with the DPT and residual it was written with.
 */
describe('archives the writer produces pass as cases', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const cal = (px: [number, number], world: [number, number, number]) => ({
    px: { x: px[0], y: px[1] },
    world: { x: world[0], y: world[1], z: world[2] },
  });

  const written: Array<[string, () => Promise<R49Archive>]> = [
    ['an empty archive', async () => {
      const archive = new R49Archive();
      archive.setManifest({
        version: 4,
        layout: { scale: 'HO' },
        camera: { resolution: { width: 1920, height: 1080 } },
      } as ManifestData);
      return archive;
    }],
    ['a labeled, calibrated archive with a camera height', async () => {
      const archive = new R49Archive();
      archive.setManifest({
        version: 4,
        layout: {
          name: 'Yard',
          scale: 'N',
          calibration: {
            points: [cal([0, 0], [0, 0, 0]), cal([600, 0], [500, 0, 0]), cal([0, 400], [0, 0, 85]), cal([640, 400], [500, 0, 85])],
            camera_height_mm: 1150,
            reference_height_mm: 85,
          },
          sensors: [{ id: 's1', x: 5, y: 6, name: 'siding 3' }],
        },
        camera: { resolution: { width: 1920, height: 1080 }, model: 'Pi HQ' },
        images: [],
      } as unknown as ManifestData);
      await archive.addImage('a.jpg', jpeg);
      await archive.addImage('shots/b.jpg', jpeg);
      archive.getManifest().images[0].labels.push(
        { id: 'a', class: 'stock', p0: { x: 1, y: 2 }, p1: { x: 3, y: 4 }, provenance: 'human' },
        { id: 'b', class: 'stock.loco', p0: { x: 1, y: 2 }, p1: { x: 3, y: 4 }, provenance: 'corrected', proposed_by: 'v1' },
      );
      archive.getManifest().images[1].labeled_complete = true;
      return archive;
    }],
    ['the frozen v4 archive, re-exported', async () => {
      const { readFile } = await import('node:fs/promises');
      return await R49Archive.load(await readFile(`${CASES}/format-v4/archive.r49`));
    }],
  ];

  for (const [what, build] of written) {
    it(what, async () => {
      const archive = await build();
      const bytes = await archive.export();
      const manifest = archive.getManifest();
      expect(
        disagreements(
          { result: 'accept', dpt: getDPT(manifest), residual: getDPTResidual(manifest), tolerance: 0 },
          await judgeArchive(bytes),
        ),
      ).toEqual([]);
    });
  }
});
