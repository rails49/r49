import { R49Archive, R49Error, getDPT, getDPTResidual, isKnownClass } from '@rails49/r49';
import { checkPath, handleOf, scopeOf } from './corpus.ts';
import { obliquityOf, pointsOffReferencePlane } from './geometry.ts';
import { RECOMMENDED_DPT } from './guidance.ts';
import { isOk, type ArchiveReport, type Finding, type Report } from './report.ts';

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
   * Archives already in the corpus that share a contributor directory with
   * something submitted. Read for their ids alone, for `archive/id-collision`.
   *
   * Scoped to the author's own directory rather than the whole corpus: the only
   * realistic collision is a contributor who re-downloaded, saved, and *added* a
   * second file where they meant to replace one, and that happens inside their
   * own directory. Corpus-wide would mean opening every archive in the repo on
   * every pull request.
   */
  readonly siblings?: readonly ArchiveInput[];
}

/** The manifest fields a report quotes, once the archive has loaded. */
function facts(archive: R49Archive): Omit<ArchiveReport, 'path' | 'scope' | 'errors' | 'warnings'> {
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
    errors: [error],
    warnings: [],
  };
}

/** The archive-level id, or `null` for anything that will not open. */
async function idOf(input: ArchiveInput): Promise<string | null> {
  try {
    const archive = await R49Archive.load(input.bytes);
    return archive.getManifest().id ?? null;
  } catch {
    // A sibling that does not load is not this pull request's problem. It has
    // its own report if it was submitted here, and is somebody else's if not.
    return null;
  }
}

/**
 * `archive/id-collision` — two archives in one contributor directory must not share an id.
 *
 * Compares each submission against its already-committed siblings *and* against
 * the other submissions in the same directory, since a single pull request can
 * add both halves of a collision.
 */
async function idCollisions(
  submitted: readonly { input: ArchiveInput; id: string | null }[],
  siblings: readonly ArchiveInput[]
): Promise<Map<string, Finding[]>> {
  const byPath = new Map<string, Finding[]>();

  const committed = new Map<string, string>();
  for (const sibling of siblings) {
    const id = await idOf(sibling);
    if (id !== null) committed.set(`${handleOf(sibling.path)}\0${id}`, sibling.path);
  }

  const seen = new Map<string, string>();
  for (const { input, id } of submitted) {
    const handle = handleOf(input.path);
    if (id === null || handle === null) continue;

    const key = `${handle}\0${id}`;
    const clash = committed.get(key) ?? seen.get(key);
    if (clash !== undefined && clash !== input.path) {
      byPath.set(input.path, [
        {
          code: 'archive/id-collision',
          message:
            `This archive's id (${id}) already exists at ${clash}. If you meant to update that ` +
            `archive, replace the file rather than adding a second one — the id is its identity, ` +
            `and the path is only where it happens to live.`,
        },
      ]);
    }
    seen.set(key, input.path);
  }

  return byPath;
}

/** Validate a set of submitted archives. */
export async function validate(
  submitted: readonly ArchiveInput[],
  options: ValidateOptions = {}
): Promise<Report> {
  const author = options.author ?? null;
  const siblings = options.siblings ?? [];

  const loaded: { input: ArchiveInput; id: string | null }[] = [];
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
          `archive in its directory uses, kept on every later save.`,
      });
    }
    const warnings = qualityWarnings(archive, f);

    loaded.push({ input, id: f.id });
    reports.set(input.path, { path: input.path, scope, ...f, errors, warnings });
  }

  const collisions = await idCollisions(
    loaded.filter(l => scopeOf(l.input.path) === 'archives'),
    siblings
  );
  for (const [path, findings] of collisions) {
    const report = reports.get(path);
    if (report) reports.set(path, { ...report, errors: [...report.errors, ...findings] });
  }

  const archives = submitted.map(s => reports.get(s.path)!);
  return { version: 1, archives, ok: isOk(archives) };
}
