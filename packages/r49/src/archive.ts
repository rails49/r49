import JSZip from 'jszip';
import { R49Error, type FormatRule, type ImageMismatch } from './rules.ts';
import {
  parseManifest,
  assertManifestVersion,
  staysInArchive,
  type ManifestData,
  type Image,
} from './manifest.schema.ts';

const MANIFEST_FILE = 'manifest.json';

/** Where {@link R49Archive.writeChanges} writes: the caller's way to the base URL. */
export interface ArchiveWriter {
  put(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** What an archive opened from a base URL knows of that base. */
interface UrlBase {
  /** The base, with no trailing slash. */
  base: string;
  /** The images the base holds, as of the last read or write of each. */
  images: Set<string>;
  /** Names removed here, which `getImage` does not fetch. */
  removed: Set<string>;
}

/** Whether a segment of `name` starts with a dot, which a base URL ignores. */
function isDotPath(name: string): boolean {
  return name.split('/').some(segment => segment.startsWith('.'));
}

/**
 * The bytes at `<base>/<name>`, each segment percent-encoded, or null for a 404
 * or a dot path, which makes no request.
 * Any other failure throws something other than an {@link R49Error}: it is no
 * verdict on the archive.
 */
async function fetchFile(base: string, name: string): Promise<Uint8Array | null> {
  if (isDotPath(name)) return null;
  const url = `${base}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to read ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export class R49Archive {
  /** The whole archive; for a URL archive, only the images added and not yet written. */
  private zip: JSZip;
  private url: UrlBase | null = null;
  private manifest: ManifestData | null = null;

  constructor(zip?: JSZip) {
    this.zip = zip || new JSZip();
  }

  /**
   * Loads an .r49 archive from a zip's bytes or a base URL and validates its
   * manifest against the v4 schema. A zip is held whole in memory. A base URL is
   * read one file at a time, as `<base>/manifest.json` and `<base>/<filename>`,
   * which is how a folder is read here.
   *
   * @param data Raw zip bytes, in any form the host platform produces, or an
   *        absolute `http://` or `https://` base URL, with or without a trailing
   *        slash.
   * @throws An {@link R49Error} naming the rule broken: `archive/empty`,
   *         `archive/not-zip`, `archive/no-manifest`, `manifest/not-json`, or
   *         any rule `setManifest` names. Anything else thrown for a base URL
   *         is an HTTP or network failure, or a string that is no such URL, and
   *         no verdict on the archive.
   */
  static async load(data: Buffer | Blob | ArrayBuffer | Uint8Array | string | URL): Promise<R49Archive> {
    if (typeof data === 'string' || data instanceof URL) return await R49Archive.loadUrl(String(data));
    const size = (data as any).byteLength ?? (data as any).size ?? 0;
    if (size === 0) {
      throw new R49Error('archive/empty', 'Cannot load .r49 archive: data is empty');
    }
    try {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(data);
      } catch (err) {
        throw new R49Error('archive/not-zip', String(err), { cause: err });
      }
      const archive = new R49Archive(zip);
      await archive.readAndValidateManifest();
      return archive;
    } catch (err) {
      // The wrapper keeps the rule it caught, and a refusal detected through
      // another error (zod's, JSZip's) quotes that error. Anything
      // else that throws in here is JSZip failing to inflate an entry, which is
      // the zip being unreadable after all.
      const rule: FormatRule = err instanceof R49Error ? err.rule : 'archive/not-zip';
      const inner = err instanceof R49Error && err.cause !== undefined ? err.cause : err;
      throw new R49Error(rule, `Failed to load .r49 archive (size: ${size} bytes): ${inner}`, {
        cause: err,
      });
    }
  }

  private static async loadUrl(base: string): Promise<R49Archive> {
    if (!/^https?:\/\//i.test(base)) throw new TypeError(`Not an http or https URL: ${base}`);
    const archive = new R49Archive();
    archive.url = { base: base.replace(/\/+$/, ''), images: new Set(), removed: new Set() };
    await archive.readAndValidateManifest();
    return archive;
  }

  /**
   * Re-reads manifest.json from the archive and validates it against the v4
   * schema, replacing any in-memory manifest.
   *
   * The version is checked first and on its own, so a v3 archive fails with a
   * message naming the version rather than with a list of shape mismatches.
   *
   * @throws An {@link R49Error}: `archive/no-manifest` if manifest.json is
   *         absent, `manifest/not-json` if it is not strict UTF-8 or does not parse, or any rule
   *         `setManifest` names.
   */
  async readAndValidateManifest(): Promise<ManifestData> {
    const bytes = this.url
      ? await fetchFile(this.url.base, MANIFEST_FILE)
      : await this.zip.file(MANIFEST_FILE)?.async('uint8array');
    if (bytes === null || bytes === undefined) {
      throw new R49Error('archive/no-manifest', 'manifest.json not found in archive');
    }
    // JSZip's 'string' decodes lossily, replacing invalid UTF-8 with U+FFFD, so
    // the bytes are decoded strictly here (rails49/occupancy#191). `ignoreBOM` keeps a leading
    // byte-order mark in the text, where JSON.parse refuses it.
    let json: unknown;
    try {
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      json = JSON.parse(content);
    } catch (err) {
      throw new R49Error('manifest/not-json', String(err), { cause: err });
    }
    assertManifestVersion(json);
    this.manifest = parseManifest(json);
    if (this.url) this.url.images = new Set([...this.namedImages()].filter(name => !isDotPath(name)));
    return this.manifest;
  }

  /**
   * Writes the in-memory manifest back into the archive. Called by export();
   * rarely needed directly.
   *
   * @throws If no manifest has been loaded or set.
   */
  async saveManifest(): Promise<void> {
    this.zip.file(MANIFEST_FILE, this.manifestJson());
  }

  /** The manifest as written. See {@link saveManifest}. */
  private manifestJson(): string {
    if (!this.manifest) throw new Error('No manifest data to save');
    return JSON.stringify(this.manifest, null, 2);
  }

  /** The images the manifest names, leaving out `manifest.json` if it names that. */
  private namedImages(): Set<string> {
    const names = new Set(this.getManifest().images.map(image => image.filename));
    names.delete(MANIFEST_FILE);
    return names;
  }

  /**
   * Returns the validated manifest. The object is live — mutating it changes
   * what export() writes.
   *
   * @throws If the archive was constructed empty and no manifest has been set.
   */
  getManifest(): ManifestData {
    if (!this.manifest) throw new Error('Manifest not loaded or invalid');
    return this.manifest;
  }

  /**
   * Replaces the manifest, validating it against the v4 schema first.
   *
   * @throws An {@link R49Error} naming the rule broken: `manifest/version`,
   *         `manifest/unknown-key`, `manifest/duplicate-id`,
   *         `manifest/provenance`, `manifest/filename`, or `manifest/schema`
   *         for anything else.
   */
  setManifest(data: ManifestData): void {
    assertManifestVersion(data);
    this.manifest = parseManifest(data);
  }

  /**
   * Reads an image from the archive by its manifest filename. A URL archive
   * returns an image added and not yet written, does not fetch one removed or a
   * dot path, and fetches any other.
   *
   * @returns The image bytes, or null if no such entry exists or the name is one
   *          `manifest/filename` refuses.
   * @throws Something other than an {@link R49Error} on an HTTP or network
   *         failure, which is no verdict on the archive.
   */
  async getImage(filename: string): Promise<Uint8Array | null> {
    if (!staysInArchive(filename)) return null;
    const file = this.zip.file(filename);
    if (file) return await file.async('uint8array');
    if (!this.url || this.url.removed.has(filename)) return null;
    return await fetchFile(this.url.base, filename);
  }

  /**
   * Every file entry in the archive, `manifest.json` included, in no
   * particular order. Directory entries are omitted.
   *
   * The manifest names the images it expects; this is the other direction —
   * what the zip actually carries. A validator needs both to tell a manifest
   * naming an absent image from an image nobody references, and neither is
   * answerable through {@link getImage}, which reports only presence of a name
   * it is handed.
   *
   * A URL cannot be listed: for a URL archive this is `manifest.json` and the
   * names in the manifest.
   */
  listEntries(): string[] {
    if (this.url) return [MANIFEST_FILE, ...this.namedImages()];
    const names: string[] = [];
    this.zip.forEach((path, file) => {
      if (!file.dir) names.push(path);
    });
    return names;
  }

  /**
   * Every way the manifest and the zip disagree about which images this
   * archive holds, both directions: `images/missing` for a manifest entry with
   * no file, then `images/orphan` for a file no entry names.
   *
   * Reported, not thrown. Both are format rules, but `load` refusing an archive
   * that carries a stray image would lock its author out of the program that
   * can remove it — so a reader that holds archives to the rule, such as the
   * corpus validator, asks, and one that only needs the images it names need not.
   *
   * Empty when no manifest is loaded, and for a URL archive, which FORMAT.md
   * exempts from both rules.
   */
  imageMismatches(): ImageMismatch[] {
    if (!this.manifest || this.url) return [];
    const declared = this.manifest.images.map(img => img.filename);
    const present = new Set(this.listEntries());
    const referenced = new Set(declared);
    const mismatches: ImageMismatch[] = [];

    for (const filename of declared) {
      if (!present.has(filename)) mismatches.push({ rule: 'images/missing', filename });
    }
    for (const entry of present) {
      if (entry === MANIFEST_FILE || referenced.has(entry)) continue;
      mismatches.push({ rule: 'images/orphan', filename: entry });
    }
    return mismatches;
  }

  /**
   * Adds an image to the archive and, if a manifest is loaded, appends a
   * matching entry with no labels and `labeled_complete: false` — nothing may
   * assert completeness on a human's behalf. Adding an existing filename
   * overwrites the bytes and leaves the manifest entry (and its labels) intact.
   *
   * @throws An {@link R49Error} naming `manifest/filename` for a filename that
   *         does not stay inside the archive, which no reader would load back, or
   *         `images/missing` for a dot path on a URL archive, which ignores it.
   */
  async addImage(filename: string, data: Uint8Array | Buffer | Blob | ArrayBuffer): Promise<void> {
    if (!staysInArchive(filename)) {
      throw new R49Error('manifest/filename', `${filename} does not stay inside the archive`);
    }
    if (this.url && isDotPath(filename)) {
      throw new R49Error('images/missing', `A base URL ignores ${filename}, which has a segment that starts with a dot`);
    }
    this.zip.file(filename, data);
    this.url?.removed.delete(filename);
    if (this.manifest) {
      const exists = this.manifest.images.some((img: Image) => img.filename === filename);
      if (!exists) {
        this.manifest.images.push({ filename, labeled_complete: false, labels: [] });
      }
    }
  }

  /**
   * Removes an image and its manifest entry, including any labels. Silently
   * does nothing if the filename is not present.
   */
  removeImage(filename: string): void {
    this.zip.remove(filename);
    this.url?.removed.add(filename);
    if (this.manifest) {
      this.manifest.images = this.manifest.images.filter((img: Image) => img.filename !== filename);
    }
  }

  /**
   * Moves an image to a different position in the manifest's image list.
   * Out-of-range indices are ignored rather than throwing.
   */
  reorderImages(fromIndex: number, toIndex: number): void {
    if (!this.manifest) return;
    const images = this.manifest.images;
    if (fromIndex < 0 || fromIndex >= images.length || toIndex < 0 || toIndex >= images.length) return;
    const [movedImage] = images.splice(fromIndex, 1);
    images.splice(toIndex, 0, movedImage);
  }

  /**
   * Serializes the archive, writing the current manifest first. A URL archive
   * fetches each image it does not already hold, and keeps holding only what it
   * did.
   *
   * @returns A complete .r49 archive, ready to persist or download.
   * @throws If no manifest has been loaded or set, or a URL archive's manifest
   *         names an image the base does not hold.
   */
  async export(): Promise<Uint8Array> {
    if (!this.url) {
      await this.saveManifest();
      return await this.zip.generateAsync({ type: 'uint8array' });
    }
    const zip = new JSZip();
    for (const filename of this.namedImages()) {
      const bytes = await this.getImage(filename);
      if (bytes === null) throw new Error(`Cannot export: the manifest names ${filename}, which is missing`);
      zip.file(filename, bytes);
    }
    zip.file(MANIFEST_FILE, this.manifestJson());
    return await zip.generateAsync({ type: 'uint8array' });
  }

  /**
   * Writes a URL archive's changes through a writer the caller supplies, in the
   * order FORMAT.md asks of a folder's writer: `put` for each added image the
   * manifest names, `put` for `manifest.json`, then `remove` for each name the
   * base held at the last write and the manifest no longer names, one at a time.
   * FORMAT.md also has that writer write by rename: this keeps the order, and the
   * writer's `put` must make each write atomic.
   *
   * It takes the manifest as it stands when called, and the images added so
   * far; an edit made during the call stays unwritten for the next call. An
   * image written is no longer held in memory, and {@link getImage} fetches it.
   * A rejected `put` or `remove` rejects the call, and the next call writes what
   * is still unwritten. Make one call at a time: a second one started during the
   * first writes alongside it.
   *
   * @throws On an archive that is not a URL archive, which {@link export} writes.
   */
  async writeChanges(writer: ArchiveWriter): Promise<void> {
    if (!this.url) throw new Error('writeChanges writes a URL archive; a zip is written by export()');
    const { images } = this.url;
    const manifest = new TextEncoder().encode(this.manifestJson());
    const named = this.namedImages();
    const added = [...named].flatMap(name => {
      const file = this.zip.file(name);
      return file ? [{ name, file }] : [];
    });
    const removals = [...images].filter(name => !named.has(name));

    for (const { name, file } of added) {
      await writer.put(name, await file.async('uint8array'));
      images.add(name);
      // Added again during the put: those bytes are the next call's to write.
      if (this.zip.file(name) === file) this.zip.remove(name);
    }
    await writer.put(MANIFEST_FILE, manifest);
    for (const name of removals) {
      await writer.remove(name);
      images.delete(name);
    }
  }
}
