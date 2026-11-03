import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import JSZip from 'jszip';
import { R49Archive, type ManifestData } from '@rails49/r49';
import { RECOMMENDED_DPT } from '../src/guidance.ts';
import { readContents, validate, type ArchiveInput, type Contents } from '../src/validate.ts';

// Every archive here is built by R49Archive and exported through the real
// serializer, so the bytes under test are the bytes this project emits. Nothing
// reads a fixture off disk: a check is only meaningful if the archive that
// triggers it can be constructed exactly, and a shared fixture tree drifts from
// the assertions that depend on it.

const A_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

let photos = 0;
/** JPEG bytes no other call returns, so no two built images match unless a test says so. */
const aPhoto = () =>
  new Uint8Array([0xff, 0xd8, ...new TextEncoder().encode(String(photos++)), 0xff, 0xd9]);

/** Two calibration points far enough apart to reach the recommended DPT at HO. */
const CALIBRATED = [
  { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
  { px: { x: 1000, y: 0 }, world: { x: 800, y: 0, z: 0 } },
];

interface Build {
  id?: string | null;
  calibration?: typeof CALIBRATED | [];
  labels?: Record<string, unknown>[];
  complete?: boolean;
  images?: number;
  /** The bytes of each image, in order; their count overrides `images`. */
  photos?: Uint8Array[];
  /** The filename of each image, in order, in place of `img_<i>.jpg`. */
  filenames?: string[];
  extraEntry?: string;
  missingImage?: boolean;
}

async function build(path: string, opts: Build = {}): Promise<ArchiveInput> {
  const archive = new R49Archive();
  const count = opts.photos?.length ?? opts.images ?? 1;
  const photos = opts.photos ?? Array.from({ length: count }, aPhoto);
  const filename = (i: number) => opts.filenames?.[i] ?? `img_${i}.jpg`;
  const images = Array.from({ length: count }, (_, i) => ({
    filename: filename(i),
    labeled_complete: opts.complete ?? true,
    labels: i === 0 ? (opts.labels ?? []) : [],
  }));

  // Typed `unknown` on the way in: several tests build labels the schema
  // rejects, which is the point, and a cast from a well-typed literal would
  // not compile.
  const manifest: unknown = {
    version: 4,
    ...(opts.id === null ? {} : { id: opts.id ?? 'aBcDeFgHiJk' }),
    layout: {
      scale: 'HO',
      calibration: { points: opts.calibration ?? CALIBRATED },
      sensors: [],
    },
    camera: { resolution: { width: 1920, height: 1080 } },
    images,
  };
  archive.setManifest(manifest as ManifestData);

  if (!opts.missingImage) {
    for (let i = 0; i < count; i++) await archive.addImage(filename(i), photos[i]);
  }
  if (opts.extraEntry) await archive.addImage(opts.extraEntry, A_JPEG);
  // addImage appends a manifest entry, so the file would not be an orphan.
  // Remove the entry again so the zip carries a file nothing names.
  if (opts.extraEntry) {
    const manifest = archive.getManifest();
    manifest.images = manifest.images.filter(img => img.filename !== opts.extraEntry);
  }

  return { path, bytes: await archive.export() };
}

/**
 * A valid v4 archive carrying no `id`, assembled zip-first.
 *
 * `R49Archive` cannot make one — `saveManifest` mints on every write — so the
 * only way to exercise `archive/id` is to write `manifest.json` directly.
 */
async function idlessArchive(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: 4,
      layout: { scale: 'HO', calibration: { points: CALIBRATED }, sensors: [] },
      camera: { resolution: { width: 1920, height: 1080 } },
      images: [{ filename: 'img_0.jpg', labeled_complete: true, labels: [] }],
    })
  );
  zip.file('img_0.jpg', A_JPEG);
  return await zip.generateAsync({ type: 'uint8array' });
}

/** A built archive as the corpus beside, or before, a submission holds it. */
async function contents(path: string, opts: Build = {}): Promise<Contents> {
  return (await readContents(await build(path, opts)))!;
}

const car = (over: Record<string, unknown> = {}) => ({
  id: 'car-1',
  class: 'stock',
  p0: { x: 10, y: 20 },
  p1: { x: 110, y: 25 },
  provenance: 'human',
  ...over,
});

/** The one report produced for a single submitted archive. */
async function reportFor(input: ArchiveInput, author: string | null = 'alice') {
  const report = await validate([input], { author });
  return report.archives[0];
}

const codes = (findings: readonly { code: string }[]) => findings.map(f => f.code);

describe('validate', () => {
  describe('the blocking bar under archives/', () => {
    it('passes a well-formed submission with no findings at all', async () => {
      const result = await reportFor(await build('archives/alice/west-yard.r49', {
        labels: [car()],
      }));

      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.scope).toBe('archives');
    });

    it('reports bytes that are not a zip under the format rule they break', async () => {
      const result = await reportFor({
        path: 'archives/alice/west-yard.r49',
        bytes: new Uint8Array([1, 2, 3, 4]),
      });

      expect(codes(result.errors)).toEqual(['archive/not-zip']);
      // The facts are unknown, not zero — a row still exists for the file.
      expect(result.images).toBeNull();
      expect(result.id).toBeNull();
    });

    it('reports a manifest that is not v4 under manifest/version', async () => {
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify({ version: 3 }));
      const result = await reportFor({
        path: 'archives/alice/west-yard.r49',
        bytes: await zip.generateAsync({ type: 'uint8array' }),
      });
      expect(codes(result.errors)).toEqual(['manifest/version']);
    });

    it('blocks a manifest naming an image the archive does not carry', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { missingImage: true })
      );
      expect(codes(result.errors)).toEqual(['images/missing']);
    });

    it('blocks an image nobody references', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { extraEntry: 'stray.jpg' })
      );
      expect(codes(result.errors)).toEqual(['images/orphan']);
    });

    it('still reports everything else about an archive with a stray image', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', {
          labels: [car({ class: 'stockyard' })],
          extraEntry: 'stray.jpg',
        })
      );
      expect(codes(result.errors)).toEqual(['images/orphan', 'labels/class']);
      expect(result.images).toBe(1);
      expect(result.labels).toBe(1);
      expect(result.dpt).not.toBeNull();
    });

    it('blocks an untouched proposal, and accepts a corrected one', async () => {
      const proposed = await reportFor(
        await build('archives/alice/west-yard.r49', {
          labels: [car({ provenance: 'proposed', proposed_by: 'v1.0.0' })],
        })
      );
      expect(codes(proposed.errors)).toContain('labels/provenance');
      const message = proposed.errors.find(f => f.code === 'labels/provenance')!.message;
      expect(message).toContain('Review it');
      expect(message).not.toMatch(/editor|\bapp\b/i);

      const corrected = await reportFor(
        await build('archives/alice/west-yard.r49', {
          labels: [car({ provenance: 'corrected', proposed_by: 'v1.0.0' })],
        })
      );
      // Assisted labeling must survive the corpus, or rails49/occupancy#13's
      // payoff dies here.
      expect(corrected.errors).toEqual([]);
    });

    it('blocks a class outside the vocabulary, segment by segment', async () => {
      const unknown = await reportFor(
        await build('archives/alice/west-yard.r49', { labels: [car({ class: 'stockyard' })] })
      );
      expect(codes(unknown.errors)).toContain('labels/class');

      const nested = await reportFor(
        await build('archives/alice/west-yard.r49', {
          labels: [car({ class: 'stock.loco.steam' })],
        })
      );
      expect(nested.errors).toEqual([]);
    });

    it('blocks an archive with no id', async () => {
      // Built by hand, because R49Archive can no longer produce one: every
      // export() mints an id when the manifest lacks one. So this check fires
      // only for a hand-assembled archive or one written by a build predating
      // that change — which is exactly the population it is aimed at, and the
      // reason the message offers saving it again before writing an id by hand.
      const result = await reportFor({
        path: 'archives/alice/west-yard.r49',
        bytes: await idlessArchive(),
      });

      expect(codes(result.errors)).toEqual(['archive/id']);
      expect(result.errors[0].message).toContain('Save it again');
      expect(result.errors[0].message).toContain('top-level "id"');
      expect(result.errors[0].message).not.toMatch(/editor|\bapp\b/i);
      expect(result.id).toBeNull();
      // The rest of the archive is fine, so nothing else fires.
      expect(result.warnings).toEqual([]);
    });

    it('blocks two archives in one directory sharing an id', async () => {
      const report = await validate(
        [
          await build('archives/alice/west-yard.r49', { id: 'sameIdHere' }),
          await build('archives/alice/east-yard.r49', { id: 'sameIdHere' }),
        ],
        { author: 'alice' }
      );

      expect(codes(report.archives[0].errors)).toEqual([]);
      expect(codes(report.archives[1].errors)).toContain('archive/id-collision');
      expect(report.ok).toBe(false);
    });

    it('blocks the same id in two different directories', async () => {
      const report = await validate(
        [
          await build('archives/alice/west-yard.r49', { id: 'sameIdHere' }),
          await build('archives/bob/west-yard.r49', { id: 'sameIdHere' }),
        ],
        { author: null }
      );

      expect(codes(report.archives[1].errors)).toEqual(['archive/id-collision']);
      expect(report.archives[1].errors[0].message).toContain('archives/alice/west-yard.r49');
    });

    it('blocks an id another archive in the corpus already has', async () => {
      const report = await validate(
        [await build('archives/alice/west-yard.r49', { id: 'sameIdHere' })],
        { author: 'alice', corpus: [await contents('archives/bob/east-yard.r49', { id: 'sameIdHere' })] }
      );

      expect(codes(report.archives[0].errors)).toEqual(['archive/id-collision']);
    });
  });

  describe('images/duplicate', () => {
    it('blocks an image another archive in the corpus has', async () => {
      const photo = aPhoto();
      const report = await validate(
        [await build('archives/alice/west-yard.r49', { photos: [photo, aPhoto()] })],
        {
          author: 'alice',
          corpus: [await contents('archives/bob/east-yard.r49', { id: 'bobsArchive', photos: [photo] })],
        }
      );

      const errors = report.archives[0].errors;
      expect(codes(errors)).toEqual(['images/duplicate']);
      expect(errors[0].message).toContain('img_0.jpg');
      expect(errors[0].message).toContain('archives/bob/east-yard.r49: img_0.jpg');
    });

    it('blocks one photograph stored twice in one archive', async () => {
      const photo = aPhoto();
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { photos: [photo, photo] })
      );

      expect(codes(result.errors)).toEqual(['images/duplicate', 'images/duplicate']);
    });

    it('blocks two submissions sharing an image', async () => {
      const photo = aPhoto();
      const report = await validate(
        [
          await build('archives/alice/west-yard.r49', { id: 'firstArchive', photos: [photo] }),
          await build('archives/alice/east-yard.r49', { id: 'otherArchive', photos: [photo] }),
        ],
        { author: 'alice' }
      );

      expect(codes(report.archives[0].errors)).toEqual(['images/duplicate']);
      expect(codes(report.archives[1].errors)).toEqual(['images/duplicate']);
    });
  });

  describe('updates', () => {
    it('reports no change without the corpus before the submission', async () => {
      const result = await reportFor(await build('archives/alice/west-yard.r49'));
      expect(result.change).toBeNull();
    });

    it('calls a submission whose id is not in the base new', async () => {
      const report = await validate([await build('archives/alice/west-yard.r49')], {
        author: 'alice',
        base: [await contents('archives/bob/east-yard.r49', { id: 'bobsArchive' })],
      });

      expect(report.archives[0].change).toEqual({ kind: 'new' });
      expect(report.archives[0].warnings).toEqual([]);
    });

    it('recognises a moved archive as an update, and does not compare it with itself', async () => {
      const shots = [aPhoto(), aPhoto()];
      const report = await validate(
        [await build('archives/alice/new-name.r49', { photos: shots })],
        // The merge removes the old path, so the corpus beside the submission
        // is empty and only the base holds the earlier version.
        { author: 'alice', base: [await contents('archives/alice/old-name.r49', { photos: shots })] }
      );

      const result = report.archives[0];
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.change).toEqual({
        kind: 'update',
        from: 'archives/alice/old-name.r49',
        added: 0,
        removed: 0,
        renamed: 0,
        replaced: 0,
        relabeled: 0,
        completed: 0,
        uncompleted: 0,
        calibration: false,
      });
    });

    it('counts what an update changed, and warns where a reference by filename breaks', async () => {
      const [a, b, c, d] = [aPhoto(), aPhoto(), aPhoto(), aPhoto()];
      const earlier = await contents('archives/alice/west-yard.r49', {
        photos: [a, b, c, d],
        filenames: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
        complete: false,
      });
      const report = await validate(
        [
          await build('archives/alice/west-yard.r49', {
            // a kept and relabeled, b renamed to e, c a new photograph, d gone, f new.
            photos: [a, b, aPhoto(), aPhoto()],
            filenames: ['a.jpg', 'e.jpg', 'c.jpg', 'f.jpg'],
            labels: [car()],
            calibration: [
              { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
              { px: { x: 1200, y: 0 }, world: { x: 800, y: 0, z: 0 } },
            ],
          }),
        ],
        { author: 'alice', base: [earlier] }
      );

      const result = report.archives[0];
      expect(result.change).toEqual({
        kind: 'update',
        from: 'archives/alice/west-yard.r49',
        added: 1,
        removed: 1,
        renamed: 1,
        replaced: 1,
        relabeled: 1,
        completed: 2,
        uncompleted: 0,
        calibration: true,
      });
      expect(codes(result.warnings)).toEqual(['images/removed', 'images/renamed', 'images/replaced']);
      expect(result.warnings[0].message).toContain('d.jpg');
      expect(result.warnings[1].message).toContain('b.jpg → e.jpg');
      expect(result.warnings[2].message).toContain('c.jpg');
      expect(result.errors).toEqual([]);
    });

    it('warns when a path now holds a different archive', async () => {
      const report = await validate(
        [await build('archives/alice/west-yard.r49', { id: 'secondOneXX' })],
        { author: 'alice', base: [await contents('archives/alice/west-yard.r49', { id: 'firstOneXXX' })] }
      );

      const result = report.archives[0];
      expect(result.change).toEqual({ kind: 'new' });
      expect(codes(result.warnings)).toEqual(['archive/id-changed']);
      expect(result.warnings[0].message).toContain('firstOneXXX');
      expect(result.warnings[0].message).toContain('secondOneXX');
    });
  });

  describe('warnings, which never block', () => {
    it('warns below the recommended DPT and accepts the archive', async () => {
      const report = await validate(
        [
          await build('archives/alice/west-yard.r49', {
            // 10 px over 800 mm at HO is far below the recommended DPT.
            calibration: [
              { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
              { px: { x: 10, y: 0 }, world: { x: 800, y: 0, z: 0 } },
            ],
            labels: [car()],
          }),
        ],
        { author: 'alice' }
      );

      expect(codes(report.archives[0].warnings)).toEqual(['calibration/dpt']);
      expect(report.archives[0].warnings[0].message).toContain(`recommended ${RECOMMENDED_DPT}`);
      expect(report.archives[0].errors).toEqual([]);
      expect(report.archives[0].dpt).toBeLessThan(RECOMMENDED_DPT);
      expect(report.ok).toBe(true);
    });

    it('warns when calibration does not resolve at all', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { calibration: [], labels: [car()] })
      );

      expect(codes(result.warnings)).toContain('calibration/unresolved');
      const message = result.warnings.find(f => f.code === 'calibration/unresolved')!.message;
      expect(message).toContain('Add two reference points');
      expect(message).not.toMatch(/editor|\bapp\b/i);
      expect(result.dpt).toBeNull();
      expect(result.errors).toEqual([]);
    });

    it('warns about incomplete images', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { complete: false, images: 3 })
      );

      expect(codes(result.warnings)).toContain('images/incomplete');
      expect(result.incomplete).toBe(3);
    });

    it('says nothing about a complete image with zero labels', async () => {
      // An all-background sample is exactly what the corpus wants, and an
      // earlier candidate check would have warned on the good case.
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', { labels: [], complete: true })
      );

      expect(result.warnings).toEqual([]);
      expect(result.labels).toBe(0);
    });
  });

  describe('fixtures/', () => {
    it('is held to the full bar, and has no place in the corpus', async () => {
      const result = await reportFor({ path: 'fixtures/cars-0-10.r49', bytes: await idlessArchive() });
      expect(result.scope).toBe('unknown');
      expect(codes(result.errors)).toEqual(['path/shape', 'archive/id']);
    });
  });

  describe('facts, which the summary table renders', () => {
    it('counts images, labels and completeness, and reports the residual', async () => {
      const result = await reportFor(
        await build('archives/alice/west-yard.r49', {
          images: 2,
          complete: false,
          labels: [car(), car({ id: 'car-2' })],
        })
      );

      expect(result.images).toBe(2);
      expect(result.labels).toBe(2);
      expect(result.complete).toBe(0);
      expect(result.incomplete).toBe(2);
      expect(result.id).toBe('aBcDeFgHiJk');
      // Two points make exactly one pair, which reproduces itself: no residual.
      expect(result.dptResidual).toBeNull();
    });
  });
});
