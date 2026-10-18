import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { R49Archive } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

/**
 * The format decisions around the camera height (rails49/occupancy#139): what
 * a writer does with the two heights, and how a refusal of a key this version
 * does not know is worded.
 *
 * The camera-height arithmetic itself (rails49/occupancy#135) is in the
 * conformance cases, `height-*`, with its DPT and residual.
 */

const cal = (px: [number, number], world: [number, number, number?]) => ({
  px: { x: px[0], y: px[1] },
  world: { x: world[0], y: world[1], z: world[2] ?? 0 },
});

function manifest(calibration: Record<string, unknown>): ManifestData {
  return {
    version: 4,
    layout: { name: 'Test Layout', scale: 'HO', calibration, sensors: [] },
    camera: { resolution: { width: 1920, height: 1080 } },
    images: [],
  } as unknown as ManifestData;
}

/** Two points 100 px apart over 10 mm, at height `z`: 10 px/mm as imaged. */
const plane = (z: number, px = 100, mm = 10) => [
  cal([0, 0], [0, 0, z]),
  cal([px, 0], [mm, 0, z]),
];

describe('the schema accepts the two heights', () => {
  it('round-trips both', async () => {
    const archive = new R49Archive();
    archive.setManifest(manifest({ points: plane(0), camera_height_mm: 1150, reference_height_mm: 85 }));
    const loaded = await R49Archive.load(await archive.export());
    const { calibration } = loaded.getManifest().layout;
    expect(calibration.camera_height_mm).toBe(1150);
    expect(calibration.reference_height_mm).toBe(85);
  });

  /**
   * The rails49/occupancy#139 decision, as a regression test.
   *
   * Neither field may take a zod `.default()`: a default is populated by the
   * parser, so merely opening and re-saving someone else's archive would write
   * the key into their file. That is damage done at save time and invisible
   * afterwards. If this fails, a `.default()` has crept in.
   */
  it('does not inject either key into an archive that lacked them', async () => {
    const archive = new R49Archive();
    archive.setManifest(manifest({ points: plane(0) }));
    const json = new TextDecoder().decode(
      await (await R49Archive.load(await archive.export())).export().then(async bytes => {
        const reloaded = await R49Archive.load(bytes);
        return new TextEncoder().encode(JSON.stringify(reloaded.getManifest()));
      }),
    );
    expect(json).not.toContain('camera_height_mm');
    expect(json).not.toContain('reference_height_mm');
  });
});

describe('the unknown-key refusal is worded for the person who meets it', () => {
  /**
   * The additive fields add no version (rails49/occupancy#139), so an unknown key — not a
   * version mismatch — is how a stale reader meets a newer archive. zod's own
   * `Unrecognized key(s) in object` is legible to someone holding the schema
   * and useless to a model railroader looking at a file that will not open.
   *
   * The package does not know who called it, so it names no program: the
   * caller words its own message from the rule id (rails49/r49#17).
   */
  it('names the key, the likely cause, and the fix', () => {
    const archive = new R49Archive();
    let message = '';
    try {
      archive.setManifest(manifest({ points: [], invented_by_a_newer_build: 7 }));
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('invented_by_a_newer_build');
    expect(message).toContain('newer version of the .r49 format');
    expect(message).toContain('newer version of @rails49/r49');
    // The hedge is not padding: an unknown key is equally a hand-edit typo,
    // and nothing can tell the two apart.
    expect(message).toContain('edited by hand');
  });

  it('mentions neither the editor nor the app', () => {
    const archive = new R49Archive();
    let message = '';
    try {
      archive.setManifest(manifest({ points: [], invented_by_a_newer_build: 7 }));
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toMatch(/editor|\bapp\b|reload/i);
  });

  it('gives the dotted path, so a nested key is findable', () => {
    const archive = new R49Archive();
    let message = '';
    try {
      archive.setManifest(manifest({ points: [], focal_length_mm: 24 }));
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('layout.calibration.focal_length_mm');
  });

  it('leaves every other validation failure alone', () => {
    // Rewording a type error as "get a newer version" would send the reader
    // to the wrong place entirely.
    const archive = new R49Archive();
    let message = '';
    try {
      archive.setManifest(manifest({ points: [], camera_height_mm: 'tall' }));
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toContain('newer version');
  });
});
