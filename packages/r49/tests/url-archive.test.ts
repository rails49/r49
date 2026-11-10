import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import JSZip from 'jszip';
import { R49Archive, R49Error } from '../src/index.ts';
import { serve, type Served } from './http-server.ts';

// One seam: an archive opened from a base URL, against a real local HTTP server.
// The writer in these tests is the caller's side of `writeChanges`, which is all
// a fake needs to be: it records, and it rejects when told to.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const OTHER = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9]);
const NEW = new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]);

function manifest(...filenames: string[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: 4,
      id: 'archive-id',
      layout: { scale: 'HO' },
      camera: { resolution: { width: 1920, height: 1080 } },
      images: filenames.map(filename => ({ filename })),
    }),
  );
}

let server: Served | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function served(files: Record<string, Uint8Array>, failing: string[] = []): Promise<string> {
  server = await serve(files, failing);
  return server.url;
}

/** What is thrown, or a failure if nothing is. */
async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('reading a URL archive', () => {
  it('reads a base with or without a trailing slash, as a string or a URL', async () => {
    const base = await served({ 'manifest.json': manifest('a.jpg'), 'a.jpg': JPEG });
    for (const source of [base, `${base}/`, new URL(base)]) {
      const archive = await R49Archive.load(source);
      expect(await archive.getImage('a.jpg')).toEqual(JPEG);
    }
  });

  it('reads a base below the root of the server', async () => {
    const base = await served({ 'x/layout.r49/manifest.json': manifest(), 'x/layout.r49/a.jpg': JPEG });
    expect(await (await R49Archive.load(`${base}/x/layout.r49`)).getImage('a.jpg')).toEqual(JPEG);
  });

  it('percent-encodes each path segment', async () => {
    const name = 'my shots/a #1?100%é.jpg';
    const base = await served({ 'manifest.json': manifest(name), [name]: JPEG });
    expect(await (await R49Archive.load(base)).getImage(name)).toEqual(JPEG);
  });

  it('treats a 404 as an absent file', async () => {
    const base = await served({ 'manifest.json': manifest() });
    expect(await (await R49Archive.load(base)).getImage('absent.jpg')).toBe(null);
  });

  it('refuses a base with no manifest', async () => {
    const err = await thrown(async () => R49Archive.load(await served({ 'a.jpg': JPEG })));
    expect((err as R49Error).rule).toBe('archive/no-manifest');
  });

  it('refuses a manifest that breaks a format rule', async () => {
    const base = await served({ 'manifest.json': new TextEncoder().encode('{') });
    expect(((await thrown(() => R49Archive.load(base))) as R49Error).rule).toBe('manifest/not-json');
  });

  it('throws something other than an R49Error on a 500', async () => {
    const base = await served({ 'manifest.json': manifest('a.jpg'), 'a.jpg': JPEG }, ['a.jpg']);
    const archive = await R49Archive.load(base);
    const err = await thrown(() => archive.getImage('a.jpg'));
    expect(err instanceof R49Error).toBe(false);
    await server?.close();
    const failing = await served({ 'manifest.json': manifest() }, ['manifest.json']);
    expect((await thrown(() => R49Archive.load(failing))) instanceof R49Error).toBe(false);
  });

  it('throws something other than an R49Error when the network fails', async () => {
    const base = await served({});
    await server?.close();
    server = undefined;
    expect((await thrown(() => R49Archive.load(base))) instanceof R49Error).toBe(false);
  });

  it('refuses a string that is not an http or https URL as a misuse', async () => {
    const err = await thrown(() => R49Archive.load('layout.r49'));
    expect(err instanceof R49Error).toBe(false);
    expect(err instanceof TypeError).toBe(true);
  });

  it('returns absent, with no request, for a name that leaves the archive', async () => {
    const base = await served({ 'layout.r49/manifest.json': manifest(), x: JPEG });
    const archive = await R49Archive.load(`${base}/layout.r49`);
    server!.requests.length = 0;
    expect(await archive.getImage('../x')).toBe(null);
    expect(await archive.getImage('/x')).toBe(null);
    expect(server!.requests).toEqual([]);
  });

  it('returns absent, with no request, for a name with no file at its path', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest() }));
    server!.requests.length = 0;
    expect(await archive.getImage('')).toBe(null);
    expect(await archive.getImage('./manifest.json')).toBe(null);
    expect(await archive.getImage('shots/')).toBe(null);
    expect(server!.requests).toEqual([]);
  });

  it('returns absent, with no request, for a dot path', async () => {
    const base = await served({
      'manifest.json': manifest('.a.jpg'),
      '.a.jpg': JPEG,
      '.git/config': JPEG,
      'shots/.DS_Store': JPEG,
    });
    const archive = await R49Archive.load(base);
    server!.requests.length = 0;
    expect(await archive.getImage('.git/config')).toBe(null);
    expect(await archive.getImage('shots/.DS_Store')).toBe(null);
    expect(await archive.getImage('.a.jpg')).toBe(null);
    expect(server!.requests).toEqual([]);
  });

  it('keeps a manifest naming a dot path', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('.a.jpg') }));
    expect(archive.getManifest().images[0].filename).toBe('.a.jpg');
  });

  it('lists the manifest and the names in it, and reports no mismatch', async () => {
    const base = await served({ 'manifest.json': manifest('a.jpg', 'gone.jpg'), 'a.jpg': JPEG, stray: JPEG });
    const archive = await R49Archive.load(base);
    expect(archive.listEntries()).toEqual(['manifest.json', 'a.jpg', 'gone.jpg']);
    expect(archive.imageMismatches()).toEqual([]);
  });

  it('returns an added image without a request, and does not fetch a removed one', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('a.jpg'), 'a.jpg': JPEG }));
    server!.requests.length = 0;
    await archive.addImage('b.jpg', OTHER);
    expect(await archive.getImage('b.jpg')).toEqual(OTHER);
    archive.removeImage('a.jpg');
    expect(await archive.getImage('a.jpg')).toBe(null);
    expect(server!.requests).toEqual([]);
    expect(archive.listEntries()).toEqual(['manifest.json', 'b.jpg']);
  });

  it('holds a name removed and added again as the new bytes', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('a.jpg'), 'a.jpg': JPEG }));
    archive.removeImage('a.jpg');
    await archive.addImage('a.jpg', OTHER);
    expect(await archive.getImage('a.jpg')).toEqual(OTHER);
  });
});

describe('a name that leaves the archive, in a zip', () => {
  it('is absent', async () => {
    const zip = new JSZip().file('manifest.json', manifest()).file('x', JPEG);
    const archive = await R49Archive.load(await zip.generateAsync({ type: 'uint8array' }));
    expect(await archive.getImage('x')).toEqual(JPEG);
    expect(await archive.getImage('../x')).toBe(null);
    expect(await archive.getImage('/x')).toBe(null);
  });
});

describe('adding an image', () => {
  const zipArchive = async () => {
    const zip = new JSZip().file('manifest.json', manifest());
    return await R49Archive.load(await zip.generateAsync({ type: 'uint8array' }));
  };

  it('refuses a name the format refuses, on a zip and on a URL archive', async () => {
    for (const archive of [await zipArchive(), await R49Archive.load(await served({ 'manifest.json': manifest() }))]) {
      for (const name of ['./a.jpg', 'a/./b.jpg', 'a//b.jpg', 'a/']) {
        expect(((await thrown(() => archive.addImage(name, JPEG))) as R49Error).rule).toBe('manifest/filename');
      }
      expect(archive.getManifest().images).toEqual([]);
    }
  });

  it('refuses a dot path on a URL archive, which would ignore it', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest() }));
    for (const name of ['.a.jpg', 'shots/.a.jpg']) {
      expect(((await thrown(() => archive.addImage(name, JPEG))) as R49Error).rule).toBe('images/missing');
    }
    expect(archive.getManifest().images).toEqual([]);
  });

  it('accepts a dot path on a zip archive, which ignores nothing', async () => {
    const archive = await zipArchive();
    await archive.addImage('.a.jpg', JPEG);
    expect(await archive.getImage('.a.jpg')).toEqual(JPEG);
    const reloaded = await R49Archive.load(await archive.export());
    expect(await reloaded.getImage('.a.jpg')).toEqual(JPEG);
  });
});

describe('exporting a URL archive', () => {
  it('produces a zip holding what the archive now holds', async () => {
    const base = await served({ 'manifest.json': manifest('a.jpg', 'gone.jpg'), 'a.jpg': JPEG, 'gone.jpg': JPEG });
    const archive = await R49Archive.load(base);
    await archive.addImage('b.jpg', OTHER);
    archive.removeImage('gone.jpg');

    const reloaded = await R49Archive.load(await archive.export());

    expect(reloaded.listEntries().sort()).toEqual(['a.jpg', 'b.jpg', 'manifest.json']);
    expect(reloaded.imageMismatches()).toEqual([]);
    expect(await reloaded.getImage('a.jpg')).toEqual(JPEG);
    expect(await reloaded.getImage('b.jpg')).toEqual(OTHER);
    expect(reloaded.getManifest().id).toBe('archive-id');
  });

  it('throws when an image the manifest names is missing', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('gone.jpg') }));
    const err = await thrown(() => archive.export());
    expect(String(err)).toContain('gone.jpg');
  });

  it('leaves what writeChanges would write unchanged', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('a.jpg'), 'a.jpg': JPEG }));
    await archive.export();
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put manifest.json']);
  });
});

/** A writer that records each call, and rejects a call named in `rejecting`. */
function recording(rejecting: string[] = []) {
  const reject = new Set(rejecting);
  const calls: string[] = [];
  const written = new Map<string, Uint8Array>();
  return {
    calls,
    written,
    /** Runs once, inside the next `put` or `remove`, as an edit made during a call. */
    during: undefined as (() => Promise<void> | void) | undefined,
    async record(call: string) {
      const during = this.during;
      this.during = undefined;
      await during?.();
      if (reject.delete(call)) throw new Error(`rejected ${call}`);
      calls.push(call);
    },
    async put(name: string, bytes: Uint8Array) {
      await this.record(`put ${name}`);
      written.set(name, bytes);
    },
    async remove(name: string) {
      await this.record(`remove ${name}`);
    },
  };
}

describe('writeChanges', () => {
  const start = (...names: string[]) =>
    served({ 'manifest.json': manifest(...names), ...Object.fromEntries(names.map(name => [name, JPEG])) }).then(base =>
      R49Archive.load(base),
    );
  const writtenManifest = (writer: ReturnType<typeof recording>) =>
    JSON.parse(new TextDecoder().decode(writer.written.get('manifest.json')));

  it('throws on a zip archive', async () => {
    const empty = new R49Archive();
    await thrown(() => empty.writeChanges(recording()));
    const zip = new JSZip().file('manifest.json', manifest());
    const loaded = await R49Archive.load(await zip.generateAsync({ type: 'uint8array' }));
    const err = await thrown(() => loaded.writeChanges(recording()));
    expect(err instanceof R49Error).toBe(false);
  });

  it('calls images, then the manifest, then removals', async () => {
    const archive = await start('a.jpg', 'b.jpg');
    await archive.addImage('c.jpg', OTHER);
    await archive.addImage('d.jpg', NEW);
    archive.removeImage('a.jpg');
    archive.removeImage('b.jpg');
    const writer = recording();

    await archive.writeChanges(writer);

    expect(writer.calls).toEqual(['put c.jpg', 'put d.jpg', 'put manifest.json', 'remove a.jpg', 'remove b.jpg']);
    expect(writer.written.get('c.jpg')).toEqual(OTHER);
    expect(writtenManifest(writer).images.map((i: { filename: string }) => i.filename)).toEqual(['c.jpg', 'd.jpg']);
  });

  it('writes only the manifest on a second call with no edits', async () => {
    const archive = await start('a.jpg');
    await archive.addImage('b.jpg', OTHER);
    archive.removeImage('a.jpg');
    await archive.writeChanges(recording());
    const writer = recording();

    await archive.writeChanges(writer);

    expect(writer.calls).toEqual(['put manifest.json']);
  });

  it('writes a name removed and added again with the new bytes, and does not remove it', async () => {
    const archive = await start('a.jpg');
    archive.removeImage('a.jpg');
    await archive.addImage('a.jpg', OTHER);
    const writer = recording();

    await archive.writeChanges(writer);

    expect(writer.calls).toEqual(['put a.jpg', 'put manifest.json']);
    expect(writer.written.get('a.jpg')).toEqual(OTHER);
  });

  it('writes an image added under a name the base holds', async () => {
    const archive = await start('a.jpg');
    await archive.addImage('a.jpg', OTHER);
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.written.get('a.jpg')).toEqual(OTHER);
  });

  it('writes no manifest after a rejected put, and the next call writes the image and the manifest', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    const failing = recording(['put a.jpg']);

    await thrown(() => archive.writeChanges(failing));

    expect(failing.calls).toEqual([]);
    expect(await archive.getImage('a.jpg')).toEqual(OTHER);
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put a.jpg', 'put manifest.json']);
  });

  it('does not write again what a call wrote before a put was rejected', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    await archive.addImage('b.jpg', NEW);
    await thrown(() => archive.writeChanges(recording(['put b.jpg'])));
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put b.jpg', 'put manifest.json']);
  });

  it('retries a rejected remove on the next call', async () => {
    const archive = await start('a.jpg');
    archive.removeImage('a.jpg');
    await thrown(() => archive.writeChanges(recording(['remove a.jpg'])));
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put manifest.json', 'remove a.jpg']);
  });

  it('removes on a later call an image an earlier call wrote', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    await archive.writeChanges(recording());
    archive.removeImage('a.jpg');
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put manifest.json', 'remove a.jpg']);
  });

  it('leaves an image added during a call out of that manifest, and writes it next', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    const writer = recording();
    writer.during = () => archive.addImage('late.jpg', NEW);

    await archive.writeChanges(writer);

    expect(writer.calls).toEqual(['put a.jpg', 'put manifest.json']);
    expect(writtenManifest(writer).images.map((i: { filename: string }) => i.filename)).toEqual(['a.jpg']);
    const next = recording();
    await archive.writeChanges(next);
    expect(next.calls).toEqual(['put late.jpg', 'put manifest.json']);
    expect(next.written.get('late.jpg')).toEqual(NEW);
  });

  it('keeps for the next call new bytes added under a name while it was being written', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    const writer = recording();
    writer.during = () => archive.addImage('a.jpg', NEW);

    await archive.writeChanges(writer);

    expect(writer.written.get('a.jpg')).toEqual(OTHER);
    const next = recording();
    await archive.writeChanges(next);
    expect(next.written.get('a.jpg')).toEqual(NEW);
  });

  it('removes on the next call an image removed during a call that wrote it', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    const writer = recording();
    writer.during = () => archive.removeImage('a.jpg');

    await archive.writeChanges(writer);

    expect(writer.calls).toEqual(['put a.jpg', 'put manifest.json']);
    const next = recording();
    await archive.writeChanges(next);
    expect(next.calls).toEqual(['put manifest.json', 'remove a.jpg']);
  });

  it('holds no written image, and getImage fetches it', async () => {
    const archive = await start();
    await archive.addImage('a.jpg', OTHER);
    await archive.writeChanges(recording());
    server!.requests.length = 0;
    await archive.getImage('a.jpg');
    expect(server!.requests).toEqual(['a.jpg']);
  });

  it('never removes a dot path the manifest named, which the base ignores', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('.git/config') }));
    archive.removeImage('.git/config');
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put manifest.json']);
  });

  it('never removes the manifest, even when an image entry names it', async () => {
    const archive = await R49Archive.load(await served({ 'manifest.json': manifest('manifest.json') }));
    archive.removeImage('manifest.json');
    const writer = recording();
    await archive.writeChanges(writer);
    expect(writer.calls).toEqual(['put manifest.json']);
  });
});
