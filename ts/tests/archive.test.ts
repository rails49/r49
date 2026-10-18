import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { R49Archive, getDPT, getDPTResidual } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

// One seam: the archive. Every test here drives the package's public interface
// — build or load an archive, mutate the manifest, export, reload the bytes,
// assert on what comes back. Nothing reaches for a zod schema object or imports
// a sibling module to check an intermediate.
//
// What any reader must accept or refuse, and the fit it must compute, are
// conformance cases (../../conformance), shared with the Python package. What
// stays here is what only a writer does: round trips, image management, and
// minting and keeping the archive id.

/** A minimal valid v4 manifest, spread-and-overridden per test. */
function manifest(overrides: Record<string, unknown> = {}): ManifestData {
  return {
    version: 4,
    layout: { name: 'Test Layout', scale: 'HO', calibration: { points: [] }, sensors: [] },
    camera: { resolution: { width: 1920, height: 1080 } },
    images: [],
    ...overrides,
  } as ManifestData;
}

/** Round-trip through the real serializer: set, export bytes, load them back. */
async function roundTrip(data: ManifestData): Promise<R49Archive> {
  const archive = new R49Archive();
  archive.setManifest(data);
  return await R49Archive.load(await archive.export());
}

const car = (over: Record<string, unknown> = {}) => ({
  id: 'car-1',
  class: 'stock',
  p0: { x: 10, y: 20 },
  p1: { x: 110, y: 25 },
  provenance: 'human',
  ...over,
});

/** Calibration point at pixel (px) and world (world), z defaulting to 0. */
const cal = (px: [number, number], world: [number, number, number?]) => ({
  px: { x: px[0], y: px[1] },
  world: { x: world[0], y: world[1], z: world[2] ?? 0 },
});

describe('R49Archive', () => {
  describe('round trip', () => {
    it('preserves cars in all three provenance variants', async () => {
      const loaded = await roundTrip(manifest({
        images: [{
          filename: 'a.jpg',
          labeled_complete: true,
          labels: [
            car({ id: 'a', provenance: 'human' }),
            car({ id: 'b', provenance: 'proposed', proposed_by: 'v1.0.0' }),
            car({ id: 'c', class: 'stock.loco.steam', provenance: 'corrected', proposed_by: 'v2' }),
          ],
        }],
      }));

      const labels = loaded.getManifest().images[0].labels;
      expect(labels).toHaveLength(3);
      expect(labels[0]).toEqual(car({ id: 'a', provenance: 'human' }));
      expect(labels[1]).toEqual(car({ id: 'b', provenance: 'proposed', proposed_by: 'v1.0.0' }));
      expect(labels[2]).toEqual(
        car({ id: 'c', class: 'stock.loco.steam', provenance: 'corrected', proposed_by: 'v2' })
      );
    });

    it('preserves sensors with and without names', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          scale: 'N',
          calibration: { points: [] },
          sensors: [
            { id: 's1', x: 5, y: 6, name: 'yard ladder east' },
            { id: 's2', x: 7, y: 8 },
          ],
        },
      }));

      const sensors = loaded.getManifest().layout.sensors;
      expect(sensors[0]).toEqual({ id: 's1', x: 5, y: 6, name: 'yard ladder east' });
      // A nameless sensor stays nameless — nothing invents a "Sensor 2".
      expect(sensors[1]).toEqual({ id: 's2', x: 7, y: 8 });
      expect('name' in sensors[1]).toBe(false);
    });

    it('preserves multi-point calibration and mixed labeled_complete', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          scale: 'HO',
          sensors: [],
          calibration: { points: [cal([0, 0], [0, 0]), cal([100, 0], [10, 0]), cal([50, 50], [5, 5, 12])] },
        },
        images: [
          { filename: 'a.jpg', labeled_complete: true, labels: [] },
          { filename: 'b.jpg', labeled_complete: false, labels: [] },
        ],
      }));

      const m = loaded.getManifest();
      expect(m.layout.calibration.points).toHaveLength(3);
      expect(m.layout.calibration.points[2]).toEqual(cal([50, 50], [5, 5, 12]));
      expect(m.images.map(i => i.labeled_complete)).toEqual([true, false]);
    });

    it('carries DPT and its residual across a save and reopen unchanged', async () => {
      // What the editor writes when a user calibrates: three coplanar points,
      // one of them slightly off, so both derived numbers are non-trivial.
      const points = [cal([0, 0], [0, 0]), cal([100, 0], [10, 0]), cal([210, 0], [20, 0])];
      const authored = manifest({
        layout: { scale: 'HO', sensors: [], calibration: { points } },
      });

      const loaded = await roundTrip(authored);

      expect(loaded.getManifest().layout.calibration.points).toEqual(points);
      expect(getDPT(loaded.getManifest())).toBe(getDPT(authored));
      expect(getDPTResidual(loaded.getManifest())).toBe(getDPTResidual(authored));
      expect(getDPTResidual(loaded.getManifest())).toBeGreaterThan(0);
    });

    it('preserves layout metadata and camera resolution', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          name: 'Basement', description: 'HO switching layout', contact: 'a@b.c',
          scale: 'HO', calibration: { points: [] }, sensors: [],
        },
        camera: { resolution: { width: 4032, height: 3024 }, model: 'iPhone 13' },
      }));

      const m = loaded.getManifest();
      expect(m.layout).toMatchObject({
        name: 'Basement', description: 'HO switching layout', contact: 'a@b.c', scale: 'HO',
      });
      expect(m.camera).toEqual({ resolution: { width: 4032, height: 3024 }, model: 'iPhone 13' });
    });
  });

  describe('version', () => {
    it('refuses a v3 archive on load for its version', async () => {
      // Build v3 bytes the way v3 wrote them, bypassing the v4 validator.
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify({
        version: 3,
        layout: { scale: 'N' },
        camera: { resolution: { width: 640, height: 480 } },
        images: [{ filename: '1.jpg', labels: { m1: { x: 1, y: 2, type: 'track' } } }],
      }));
      const bytes = await zip.generateAsync({ type: 'uint8array' });

      await expect(R49Archive.load(bytes)).rejects.toMatchObject({ rule: 'format/version' });
      await expect(R49Archive.load(bytes)).rejects.toThrow(/version/i);
    });
  });

  describe('image management', () => {
    it('appends an image with no labels and labeled_complete false', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest());

      const imgData = new Uint8Array([1, 2, 3]);
      await archive.addImage('test.jpg', imgData);

      const images = archive.getManifest().images;
      expect(images).toHaveLength(1);
      expect(images[0]).toEqual({ filename: 'test.jpg', labeled_complete: false, labels: [] });
      expect(await archive.getImage('test.jpg')).toEqual(imgData);

      archive.removeImage('test.jpg');
      expect(archive.getManifest().images).toHaveLength(0);
    });

    it('reorders images', () => {
      const archive = new R49Archive();
      archive.setManifest(manifest({
        images: [
          { filename: '1.jpg', labeled_complete: false, labels: [] },
          { filename: '2.jpg', labeled_complete: false, labels: [] },
          { filename: '3.jpg', labeled_complete: false, labels: [] },
        ],
      }));

      archive.reorderImages(0, 2);
      expect(archive.getManifest().images.map(i => i.filename)).toEqual(['2.jpg', '3.jpg', '1.jpg']);

      archive.reorderImages(2, 1);
      expect(archive.getManifest().images.map(i => i.filename)).toEqual(['2.jpg', '1.jpg', '3.jpg']);
    });

    it('removes an image together with its labels', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest({
        images: [{ filename: 'a.jpg', labeled_complete: true, labels: [car()] }],
      }));

      archive.removeImage('a.jpg');
      expect(archive.getManifest().images).toHaveLength(0);
      expect(await archive.getImage('a.jpg')).toBeNull();
    });
  });

  // The archive-level id is identity: optional at the format layer, required
  // by the corpus repo, and — once minted — never changed by anything this
  // package does. The two properties below are the whole contract, and both
  // are about *writes*, because a write is the only thing that could break it.
  describe('archive id', () => {
    it('mints one on write when the manifest has none', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest());
      expect(archive.getManifest().id).toBeUndefined();

      const loaded = await R49Archive.load(await archive.export());
      expect(loaded.getManifest().id).toEqual(expect.any(String));
      expect(loaded.getManifest().id).not.toHaveLength(0);
    });

    it('never overwrites an existing id, however many times it is written', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest({ id: 'aBcDeFgHiJk' }));

      // Three writes, because the download fallback writes a freshly-named
      // file on every save: if minting were unconditional this is where a
      // single archive would acquire a new identity per save.
      await archive.export();
      await archive.export();
      const loaded = await R49Archive.load(await archive.export());

      expect(loaded.getManifest().id).toBe('aBcDeFgHiJk');
    });

    it('keeps the frozen fixture\'s id through a re-export', async () => {
      const frozen = await readFile(
        fileURLToPath(new URL('../../conformance/format-v4/archive.r49', import.meta.url)),
      );
      const rewritten = await R49Archive.load(await (await R49Archive.load(frozen)).export());
      expect(rewritten.getManifest().id).toBe('0PKAbvK57FA');
    });

    it('mints ids with the moved generator: 11 base62 characters', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest());
      const loaded = await R49Archive.load(await archive.export());
      expect(loaded.getManifest().id).toMatch(/^[0-9A-Za-z]{11}$/);
    });

    it('carries a minted id through a reload and a second export unchanged', async () => {
      const first = new R49Archive();
      first.setManifest(manifest());
      const reloaded = await R49Archive.load(await first.export());
      const minted = reloaded.getManifest().id;

      const again = await R49Archive.load(await reloaded.export());
      expect(again.getManifest().id).toBe(minted);
    });
  });
});
