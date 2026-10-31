import { createHash } from 'node:crypto';
import {
  R49Archive,
  R49Error,
  getDPT,
  getDPTResidual,
  isKnownClass,
  type Image,
  type ManifestData,
} from '@rails49/r49';
import { checkPath, scopeOf } from './corpus.ts';
import { obliquityOf, pointsOffReferencePlane } from './geometry.ts';
import { RECOMMENDED_DPT } from './guidance.ts';
import { isOk, type ArchiveReport, type Change, type Finding, type Report } from './report.ts';

/**
 * What CI asserts about a corpus submission — FORMAT.md § Corpus rules, its
 * blocking rules and its warnings — over archives already read into memory.
 *
 * Pure by construction: bytes in, report out, no filesystem and no process.
 * `cli.ts` does the reading and the exiting. That is what lets every check be
 * tested against a purpose-built archive rather than against a fixture tree
 * someone has to keep in sync.
 */

/** One archive to examine, with the repo-relative path it sits at. */
export interface ArchiveInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ValidateOptions {
  /**
   * The pull request author's handle. `null` (the default) skips only the
   * directory-ownership rule — a local run cannot know it, and refusing to run
   * without it would make the tool useless to the contributor it exists to help.
   */
  readonly author?: string | null;
  /**
   * Every other archive in the corpus as it is with the submission in place,
   * for `archive/id-collision` and `images/duplicate`.
   */
  readonly corpus?: readonly Contents[];
  /**
   * The corpus before the submission, such as a pull request's base. A
   * submission with the id of one of these is an update and is compared with
   * it. `null` (the default) leaves every report's `change` unknown.
   */
  readonly base?: readonly Contents[] | null;
}

/**
 * What one archive holds, read once: its id, its manifest, and the SHA-256 of
 * each image's bytes by filename. The checks that compare archives read only
 * this, so an archive other than a submission is opened once and not kept.
 */
export interface Contents {
  readonly path: string;
  readonly id: string | null;
  readonly manifest: ManifestData;
  readonly images: ReadonlyMap<string, string>;
}

async function contentsOf(path: string, archive: R49Archive): Promise<Contents> {
  const manifest = archive.getManifest();
  const images = new Map<string, string>();
  for (const image of manifest.images) {
    const bytes = await archive.getImage(image.filename);
    if (bytes) images.set(image.filename, createHash('sha256').update(bytes).digest('hex'));
  }
  return { path, id: manifest.id ?? null, manifest, images };
}

/** The contents of an archive that is not a submission, or `null` for one that will not open. */
export async function readContents(input: ArchiveInput): Promise<Contents | null> {
  try {
    return await contentsOf(input.path, await R49Archive.load(input.bytes));
  } catch {
    // An archive that does not load is not this submission's problem. It has
    // its own report if it was submitted here, and is somebody else's if not.
    return null;
  }
}

/** The manifest fields a report quotes, once the archive has loaded. */
function facts(
  archive: R49Archive
): Omit<ArchiveReport, 'path' | 'scope' | 'change' | 'errors' | 'warnings'> {
  const manifest = archive.getManifest();
  const images = manifest.images;
  const obliquity = obliquityOf(manifest);
  return {
    id: manifest.id ?? null,
    dpt: getDPT(manifest),
    dptResidual: getDPTResidual(manifest),
    cameraHeightMM: manifest.layout.calibration.camera_height_mm ?? null,
    referenceHeightMM: manifest.layout.calibration.reference_height_mm ?? null,
    obliquityDeg: obliquity?.degrees ?? null,
    widthInflation: obliquity?.widthInflation ?? null,
    images: images.length,
    labels: images.reduce((n, img) => n + img.labels.length, 0),
    complete: images.filter(img => img.labeled_complete).length,
    incomplete: images.filter(img => !img.labeled_complete).length,
  };
}

/**
 * `images/missing` and `images/orphan` — the manifest and the zip must name the
 * same images, both ways. Format rules, but `load()` reports them rather than
 * refusing, so they are checked here.
 */
function checkImages(archive: R49Archive): Finding[] {
  return archive.imageMismatches().map(({ rule, filename }) => ({
    code: rule,
    message:
      rule === 'images/missing'
        ? `The manifest names ${filename}, but the archive contains no such file.`
        : `${filename} is in the archive but no manifest entry references it. ` +
          `An unreferenced image is weight the corpus carries in git forever.`,
  }));
}

/** `labels/provenance` and `labels/class` — what a label may claim, and what it may be called. */
function checkLabels(archive: R49Archive): Finding[] {
  const findings: Finding[] = [];

  for (const image of archive.getManifest().images) {
    for (const label of image.labels) {
      if (label.provenance === 'proposed') {
        findings.push({
          code: 'labels/provenance',
          message:
            `${image.filename}: label ${label.id} is still "proposed" — untouched model output. ` +
            `Review it, then set its provenance to "corrected" and keep its proposed_by, which ` +
            `is accepted here. Training on unreviewed proposals is the one thing this corpus ` +
            `exists to prevent.`,
        });
      }
      if (!isKnownClass(label.class)) {
        findings.push({
          code: 'labels/class',
          message:
            `${image.filename}: label ${label.id} has class "${label.class}", which is not in ` +
            `the vocabulary (FORMAT.md § The vocabulary). If your rolling ` +
            `stock genuinely is not representable, please open an issue — the vocabulary is ` +
            `meant to grow.`,
        });
      }
    }
  }

  return findings;
}

/** The quality warnings. Signals for the maintainer; never blocking. */
function qualityWarnings(archive: R49Archive, f: ReturnType<typeof facts>): Finding[] {
  const warnings: Finding[] = [];

  // Deliberately *not* a warning: a missing camera height. It would fire on
  // every submission from day one, and a warning that always
  // fires devalues the ones that mean something (rails49/occupancy#139). Here the
  // height is a fact in the table. This narrower condition is the one place the
  // fit silently means something other than the contributor intends.
  const offPlane = pointsOffReferencePlane(archive.getManifest());
  if (offPlane > 0) {
    warnings.push({
      code: 'calibration/off-reference-plane',
      message:
        `${offPlane} calibration point${offPlane === 1 ? ' sits' : 's sit'} off the plane DPT is ` +
        `measured on, and without a camera height ${offPlane === 1 ? 'it is' : 'they are'} ` +
        `excluded from the fit. Add layout.calibration.camera_height_mm so every point ` +
        `contributes, or move ${offPlane === 1 ? 'it' : 'them'} onto the reference plane.`,
    });
  }

  if (f.dpt === null) {
    warnings.push({
      code: 'calibration/unresolved',
      message:
        `Calibration does not resolve, so no DPT can be computed and no geometric claim ` +
        `about this archive can be checked. Add two reference points at the same height, ` +
        `apart in x or y. Without a camera height, put both at the reference height.`,
    });
  } else if (f.dpt < RECOMMENDED_DPT) {
    warnings.push({
      code: 'calibration/dpt',
      message:
        `DPT is ${f.dpt.toFixed(1)}, below the recommended ${RECOMMENDED_DPT}. The archive is ` +
        `accepted, but a reader that needs more may leave it out. Move the camera closer or ` +
        `frame a shorter stretch of track.`,
    });
  }

  if ((f.incomplete ?? 0) > 0) {
    warnings.push({
      code: 'images/incomplete',
      message:
        `${f.incomplete} of ${f.images} images are not marked complete. Only a complete image ` +
        `can be trained on — its unlabeled areas are what teach the detector what background ` +
        `looks like.`,
    });
  }

  return warnings;
}

/** A report for an archive that never loaded: the facts are unknown, not zero. */
function unloadable(path: string, error: Finding): ArchiveReport {
  return {
    path,
    scope: scopeOf(path),
    id: null,
    dpt: null,
    dptResidual: null,
    cameraHeightMM: null,
    referenceHeightMM: null,
    obliquityDeg: null,
    widthInflation: null,
    images: null,
    labels: null,
    complete: null,
    incomplete: null,
    change: null,
    errors: [error],
    warnings: [],
  };
}

/**
 * `archive/id-collision` — no two archives in the corpus share an id.
 *
 * Compares each submission against the rest of the corpus *and* against the
 * other submissions, since a single pull request can add both halves of a
 * collision.
 */
function idCollisions(
  submitted: readonly Contents[],
  corpus: readonly Contents[]
): Map<string, Finding[]> {
  const byPath = new Map<string, Finding[]>();

  const seen = new Map<string, string>();
  for (const other of corpus) if (other.id !== null) seen.set(other.id, other.path);

  for (const { path, id } of submitted) {
    if (id === null) continue;
    const clash = seen.get(id);
    if (clash !== undefined && clash !== path) {
      byPath.set(path, [
        {
          code: 'archive/id-collision',
          message:
            `This archive's id (${id}) already exists at ${clash}. If you meant to update that ` +
            `archive, replace the file rather than adding a second one — the id is its identity, ` +
            `and the path is only where it happens to live.`,
        },
      ]);
    }
    seen.set(id, path);
  }

  return byPath;
}

/**
 * `images/duplicate` — no two images in the corpus have the same bytes.
 *
 * Each submitted image is compared with every other image in the submissions
 * and the rest of the corpus. The version an update replaces is in neither, so
 * an update is never compared with itself.
 */
function duplicateImages(
  submitted: readonly Contents[],
  corpus: readonly Contents[]
): Map<string, Finding[]> {
  const places = new Map<string, string[]>();
  for (const archive of [...submitted, ...corpus]) {
    for (const [filename, hash] of archive.images) {
      places.set(hash, [...(places.get(hash) ?? []), `${archive.path}: ${filename}`]);
    }
  }

  const byPath = new Map<string, Finding[]>();
  for (const archive of submitted) {
    const findings: Finding[] = [];
    for (const [filename, hash] of archive.images) {
      const here = `${archive.path}: ${filename}`;
      const elsewhere = places.get(hash)!.filter(place => place !== here);
      if (elsewhere.length === 0) continue;
      findings.push({
        code: 'images/duplicate',
        message:
          `${filename} has the same bytes as ${elsewhere.join(', ')}. A photograph is in the ` +
          `corpus once: keep one copy and remove the others.`,
      });
    }
    if (findings.length > 0) byPath.set(archive.path, findings);
  }

  return byPath;
}

/** Why a reference to an image may break, added to each image-level update warning. */
const BROKEN_REFERENCE =
  'Anything that refers to an image by archive id and filename, such as a held-out test set, ' +
  'no longer finds it.';

/**
 * How a submission relates to the corpus before it, and the warnings that
 * follow: `archive/id-changed`, `images/removed`, `images/renamed` and
 * `images/replaced`.
 */
function compareWithBase(
  submitted: Contents,
  base: readonly Contents[]
): { change: Change; warnings: Finding[] } {
  const sameId = base.filter(b => b.id !== null && b.id === submitted.id);
  const earlier = sameId.find(b => b.path === submitted.path) ?? sameId[0];

  if (earlier === undefined) {
    const displaced = base.find(b => b.path === submitted.path);
    const warnings: Finding[] = [];
    if (displaced !== undefined) {
      warnings.push({
        code: 'archive/id-changed',
        message:
          `${submitted.path} held the archive ${displaced.id ?? 'with no id'}, and now holds ` +
          `${submitted.id ?? 'one with no id'}: a different archive. ${BROKEN_REFERENCE} If you ` +
          `meant to update that archive, keep its id.`,
      });
    }
    return { change: { kind: 'new' }, warnings };
  }

  const before = new Map(earlier.manifest.images.map(img => [img.filename, img]));
  const after = new Map(submitted.manifest.images.map(img => [img.filename, img]));
  const afterByHash = new Map([...submitted.images].map(([filename, hash]) => [hash, filename]));

  const kept: [Image, Image][] = [];
  const removed: string[] = [];
  const renamed: string[] = [];
  const replaced: string[] = [];
  const accounted = new Set<string>();

  for (const [filename, old] of before) {
    const hash = earlier.images.get(filename);
    const same = after.get(filename);
    if (same !== undefined) {
      accounted.add(filename);
      if (hash !== undefined && submitted.images.get(filename) !== hash) replaced.push(filename);
      else kept.push([old, same]);
      continue;
    }
    const moved = hash === undefined ? undefined : afterByHash.get(hash);
    if (moved !== undefined && !before.has(moved)) {
      accounted.add(moved);
      renamed.push(`${filename} → ${moved}`);
      kept.push([old, after.get(moved)!]);
    } else {
      removed.push(filename);
    }
  }

  const warnings: Finding[] = [];
  if (removed.length > 0) {
    warnings.push({
      code: 'images/removed',
      message: `This update removes ${removed.join(', ')}. ${BROKEN_REFERENCE}`,
    });
  }
  if (renamed.length > 0) {
    warnings.push({
      code: 'images/renamed',
      message: `This update renames ${renamed.join(', ')}. ${BROKEN_REFERENCE}`,
    });
  }
  if (replaced.length > 0) {
    warnings.push({
      code: 'images/replaced',
      message:
        `This update stores a different photograph under ${replaced.join(', ')}. A reference ` +
        `to it by archive id and filename, such as a held-out test set, now finds the new one.`,
    });
  }

  const labels = (img: Image) => JSON.stringify(img.labels);
  const change: Change = {
    kind: 'update',
    from: earlier.path,
    added: [...after.keys()].filter(filename => !accounted.has(filename)).length,
    removed: removed.length,
    renamed: renamed.length,
    replaced: replaced.length,
    relabeled: kept.filter(([a, b]) => labels(a) !== labels(b)).length,
    completed: kept.filter(([a, b]) => !a.labeled_complete && b.labeled_complete).length,
    uncompleted: kept.filter(([a, b]) => a.labeled_complete && !b.labeled_complete).length,
    calibration:
      JSON.stringify(earlier.manifest.layout.calibration) !==
      JSON.stringify(submitted.manifest.layout.calibration),
  };
  return { change, warnings };
}

/** Validate a set of submitted archives. */
export async function validate(
  submitted: readonly ArchiveInput[],
  options: ValidateOptions = {}
): Promise<Report> {
  const author = options.author ?? null;
  const corpus = options.corpus ?? [];
  const base = options.base ?? null;

  const loaded: Contents[] = [];
  const reports = new Map<string, ArchiveReport>();

  for (const input of submitted) {
    const scope = scopeOf(input.path);

    let archive: R49Archive;
    try {
      archive = await R49Archive.load(input.bytes);
    } catch (err) {
      // Every format rule but the two image rules is load()'s to refuse, and a
      // refusal is reported under the id of the rule broken. Anything else
      // thrown is a bug, not a verdict on the archive, and fails the tool.
      if (!(err instanceof R49Error)) throw err;
      reports.set(
        input.path,
        unloadable(input.path, {
          code: err.rule,
          message: `${input.path} breaks the format rule ${err.rule}: ${err.message}`,
        })
      );
      continue;
    }

    const f = facts(archive);
    const errors: Finding[] = [
      ...checkPath(input.path, author),
      ...checkImages(archive),
      ...checkLabels(archive),
    ];
    if (f.id === null) {
      errors.push({
        code: 'archive/id',
        message:
          `${input.path} has no archive-level id. Save it again with a writer that adds one, ` +
          `or add a top-level "id" to its manifest.json: a non-empty string no other ` +
          `archive in the corpus uses, kept on every later save.`,
      });
    }
    const warnings = qualityWarnings(archive, f);

    const contents = await contentsOf(input.path, archive);
    let change: Change | null = null;
    if (base !== null) {
      const compared = compareWithBase(contents, base);
      change = compared.change;
      warnings.push(...compared.warnings);
    }

    loaded.push(contents);
    reports.set(input.path, { path: input.path, scope, ...f, change, errors, warnings });
  }

  const inCorpus = loaded.filter(c => scopeOf(c.path) === 'archives');
  for (const found of [idCollisions(inCorpus, corpus), duplicateImages(inCorpus, corpus)]) {
    for (const [path, findings] of found) {
      const report = reports.get(path)!;
      reports.set(path, { ...report, errors: [...report.errors, ...findings] });
    }
  }

  const archives = submitted.map(s => reports.get(s.path)!);
  return { version: 1, archives, ok: isOk(archives) };
}
