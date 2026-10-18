import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { R49Archive } from '../src/index.ts';

/**
 * The one thing `archive.test.ts` structurally cannot prove.
 *
 * Every other test in this package writes with the same code it reads with, so
 * `write(x); read() === x` passes even when the writer and the parser drift
 * **together** — a field renamed on both sides round-trips perfectly while every
 * archive already on disk quietly stops loading. `format-v4.r49` was written
 * once and is never regenerated, so it is the only artifact here that can fail
 * that way.
 *
 * That the committed bytes still load as v4 and report the same DPT and
 * residual is the conformance case `format-v4`, which every implementation
 * runs. What only this package can check stays here: that they still yield
 * their image, plus the two fields most likely to be broken silently, the
 * `provenance` union and the archive id.
 *
 * **If this fails, the change under test breaks v4 and needs a version bump.**
 * Regenerating the fixture to make it pass destroys the only thing it does.
 * See `conformance/cases/format-v4/README.md`.
 */

const FIXTURE = fileURLToPath(new URL('../../../conformance/cases/format-v4/archive.r49', import.meta.url));

async function loadFixture(): Promise<R49Archive> {
  return await R49Archive.load(await readFile(FIXTURE));
}

describe('the frozen v4 fixture', () => {
  it('still yields its image bytes', async () => {
    const bytes = await (await loadFixture()).getImage('frame.jpg');
    expect(bytes).not.toBeNull();
    // A JPEG's SOI marker. Enough to show the entry decompressed.
    expect(Array.from(bytes!.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('still carries both arms of the provenance union', async () => {
    const labels = (await loadFixture()).getManifest().images[0].labels;

    const human = labels.find(l => l.id === 'label-human-1');
    expect(human?.provenance).toBe('human');
    expect(human).not.toHaveProperty('proposed_by');

    const corrected = labels.find(l => l.id === 'label-corrected-1');
    expect(corrected?.provenance).toBe('corrected');
    expect(corrected).toMatchObject({ proposed_by: 'fixture-model-v1' });
  });

  it('still carries its archive id and its sensor', async () => {
    const manifest = (await loadFixture()).getManifest();
    expect(manifest.id).toBe('0PKAbvK57FA');
    expect(manifest.layout.sensors).toEqual([
      { id: 'sensor-fixture-1', x: 640, y: 500, name: 'siding 3' },
    ]);
  });

  it('keeps its id through a re-export, which must not mint a new one', async () => {
    const archive = await loadFixture();
    const rewritten = await R49Archive.load(await archive.export());
    expect(rewritten.getManifest().id).toBe('0PKAbvK57FA');
  });
});
