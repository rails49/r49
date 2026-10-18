import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import JSZip from 'jszip';
import { R49Archive, R49Error, getDPT, getDPTResidual } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

// One seam: the archive. Every test here drives the package's public interface
// — build or load an archive, mutate the manifest, export, reload the bytes,
// assert on what comes back. Nothing reaches for a zod schema object, asserts
// on a parse error's internal shape, or imports a sibling module to check an
// intermediate: the schemas are deliberately withheld from index.ts so that
// validation stays replaceable, and a test that pinned them down would undo
// that.
//
// What any reader must decide the same way — accept or refuse, with which rule
// id, and the DPT and residual — is in conformance/cases/ and runs in
// conformance.test.ts. What stays here is this package's own: writing, minting
// and keeping an archive id, and what a loaded manifest holds.

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

/**
 * Round-trip through the real serializer: set, add the images the manifest
 * names, export bytes, load them back.
 */
async function roundTrip(data: ManifestData): Promise<R49Archive> {
  const archive = new R49Archive();
  archive.setManifest(data);
  for (const { filename } of archive.getManifest().images) {
    await archive.addImage(filename, new Uint8Array([0xff, 0xd8]));
  }
  return await R49Archive.load(await archive.export());
}

/** Assert that setting this manifest is rejected, and return the error. */
function rejection(data: unknown): R49Error {
  const archive = new R49Archive();
  try {
    archive.setManifest(data as ManifestData);
  } catch (err) {
    if (err instanceof R49Error) return err;
    throw err;
  }
  throw new Error('expected the manifest to be rejected, but it was accepted');
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

  describe('defaults, as read back', () => {
    it('defaults an absent calibration to empty points', async () => {
      const loaded = await roundTrip(manifest({ layout: { scale: 'N' } }));
      expect(loaded.getManifest().layout.calibration).toEqual({ points: [] });
      expect(loaded.getManifest().layout.sensors).toEqual([]);
    });

    it('defaults an absent labeled_complete to false', async () => {
      const loaded = await roundTrip(manifest({ images: [{ filename: 'a.jpg' }] }));
      const image = loaded.getManifest().images[0];
      expect(image.labeled_complete).toBe(false);
      expect(image.labels).toEqual([]);
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

  describe('imageMismatches', () => {
    it('names images on both sides of the manifest–zip difference', () => {
      // The manifest names one image the zip lacks; the zip holds one the
      // manifest does not name.
      const archive = new R49Archive(new JSZip().file('unnamed.jpg', new Uint8Array([1])));
      archive.setManifest(manifest({ images: [{ filename: 'absent.jpg' }] }));

      expect(archive.imageMismatches()).toEqual([
        { rule: 'images/missing', filename: 'absent.jpg' },
        { rule: 'images/orphan', filename: 'unnamed.jpg' },
      ]);
    });

    it('is empty for an archive built through the writer', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest());
      await archive.addImage('a.jpg', new Uint8Array([1]));
      expect(archive.imageMismatches()).toEqual([]);
    });
  });

  describe('the writer', () => {
    it('refuses a non-finite number handed to setManifest', () => {
      const m = manifest({ layout: { scale: 'HO', calibration: { points: [cal([0, 0], [Infinity, 0])] } } });
      expect(rejection(m).rule).toBe('manifest/schema');
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
      expect(typeof loaded.getManifest().id).toBe('string');
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

    it('carries a minted id through a reload and a second export unchanged', async () => {
      const first = new R49Archive();
      first.setManifest(manifest());
      const reloaded = await R49Archive.load(await first.export());
      const minted = reloaded.getManifest().id;

      const again = await R49Archive.load(await reloaded.export());
      expect(again.getManifest().id).toBe(minted);
    });

  });

  // Strictness is per object in zod, so it has to be asserted per object:
  // a schema that gained a nested object without `.strict()` would pass every
  // test above while silently deleting whatever a newer build wrote into it.
  // That each object refuses an unknown key is the conformance cases'
  // (`reject-unknown-key-*`); they assert the rule id and cannot see a message.
  describe('an unknown-key refusal names the key, in every object', () => {
    // Asserted on the *offending key*, not on the wording. The message is
    // reworded for the person who meets it (rails49/occupancy#139) and may be
    // reworded again; what must never change is that the refusal names what
    // was wrong.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['the manifest root', manifest({ vendor_extra: 1 }), 'vendor_extra'],
      ['layout', manifest({ layout: { scale: 'HO', calibration: { points: [] }, sensors: [], hue: 1 } }), 'layout.hue'],
      ['calibration', manifest({ layout: { scale: 'HO', calibration: { points: [], fitted: true }, sensors: [] } }), 'layout.calibration.fitted'],
      [
        'a calibration point',
        manifest({
          layout: {
            scale: 'HO',
            calibration: { points: [{ ...cal([0, 0], [0, 0]), label: 'origin' }] },
            sensors: [],
          },
        }),
        'layout.calibration.points.0.label',
      ],
      [
        'a point',
        manifest({
          layout: {
            scale: 'HO',
            calibration: { points: [{ px: { x: 0, y: 0, z: 0 }, world: { x: 0, y: 0, z: 0 } }] },
            sensors: [],
          },
        }),
        'layout.calibration.points.0.px.z',
      ],
      [
        'a world point',
        manifest({
          layout: {
            scale: 'HO',
            calibration: { points: [{ px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0, w: 0 } }] },
            sensors: [],
          },
        }),
        'layout.calibration.points.0.world.w',
      ],
      [
        'a sensor',
        manifest({
          layout: {
            scale: 'HO',
            calibration: { points: [] },
            sensors: [{ id: 's1', x: 1, y: 2, colour: 'red' }],
          },
        }),
        'layout.sensors.0.colour',
      ],
      ['camera', manifest({ camera: { resolution: { width: 1920, height: 1080 }, fps: 30 } }), 'camera.fps'],
      ['camera resolution', manifest({ camera: { resolution: { width: 1920, height: 1080, depth: 8 } } }), 'camera.resolution.depth'],
      ['an image', manifest({ images: [{ filename: 'a.jpg', labels: [], captured_at: 'now' }] }), 'images.0.captured_at'],
      ['a car label', manifest({ images: [{ filename: 'a.jpg', labels: [car({ colour: 'red' })] }] }), 'images.0.labels.0.colour'],
    ];

    for (const [where, data, key] of cases) {
      it(`in ${where}`, () => {
        expect(rejection(data).message).toContain(key);
      });
    }

    it('keeps accepting every optional key the format does define', async () => {
      const loaded = await roundTrip(
        manifest({
          id: 'aBcDeFgHiJk',
          layout: {
            name: 'Yard',
            description: 'west end',
            contact: 'me@example.com',
            scale: 'HO',
            calibration: { points: [] },
            sensors: [{ id: 's1', x: 1, y: 2, name: 'siding 3' }],
          },
          camera: { resolution: { width: 1920, height: 1080 }, model: 'Pi HQ' },
        })
      );

      const m = loaded.getManifest();
      expect(m.id).toBe('aBcDeFgHiJk');
      expect(m.layout.description).toBe('west end');
      expect(m.layout.sensors[0].name).toBe('siding 3');
      expect(m.camera.model).toBe('Pi HQ');
    });
  });
});
