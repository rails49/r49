import { z } from 'zod';
import { SCALES, type Scale } from './data.ts';
import { FormatError, type FormatRule } from './errors.ts';

/**
 * Every valid scale name, in the order the data file defines them.
 *
 * Sourced from `data/r49.json`; this package declares no scale table of its
 * own.
 */
export const VALID_SCALES: readonly Scale[] = SCALES;

/** A scale name. */
export type ValidScales = Scale;

/**
 * The manifest version this package reads and writes. There is no v3 code here
 * and no compatibility shim: loading anything else fails on the version number
 * alone. The existing archives were converted once, by a throwaway script.
 */
export const MANIFEST_VERSION = 4;

const ScaleSchema = z.enum(SCALES);

// Every object below is `.strict()`: an unknown key is a parse error, not
// something to strip. zod's default is to drop unrecognized keys silently,
// which means a manifest written by a newer build round-trips through an older
// one *shorter* than it arrived — the same failure class as a defaulted
// `scale` or a defaulted `provenance`, and invisible until something
// downstream misses a field nobody knows was deleted. Strictness is per
// object, so it has to be spelled on each one; a new object schema without it
// reopens the hole quietly.
const PointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const WorldPointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  })
  .strict();

const CalibrationPointSchema = z
  .object({
    /** Where the feature is in the image. */
    px: PointSchema,
    /** Where it is on the layout, in mm from an arbitrary but fixed origin. */
    world: WorldPointSchema,
  })
  .strict();

// Calibration is always present with `points` defaulting to []. "Uncalibrated"
// is a real state the editor handles, and an empty list expresses it without
// every consumer null-checking the parent.
//
// The two heights below are `.optional()` and deliberately **not** `.default()`
// (#139). A default is populated by the parser, so the first save of any
// archive — including one merely opened to look at — would write the key into
// someone else's file. That is damage done at save time and invisible
// afterwards, which is the failure the strictness note above exists to prevent.
// They add no version: an old archive loads unchanged, and a new archive is
// refused rather than misread, which is the loud failure `.strict()` produces.
const CalibrationSchema = z
  .object({
    points: z.array(CalibrationPointSchema).default([]),
    /**
     * Camera height above layout zero, in mm. Optional here, required by the
     * editor — see FORMAT.md § The calibration fit. `.positive()` because a camera at or below
     * the origin is not a representable pose and every consumer divides by
     * `h − z`; the cross-field rule that it must also clear the tallest
     * calibration point is the editor's, not the schema's.
     */
    camera_height_mm: z.number().positive().optional(),
    /**
     * Railhead height above layout zero, in mm — the plane DPT is reported at.
     * Absent reads as 0, which is the historical meaning of DPT.
     */
    reference_height_mm: z.number().optional(),
  })
  .strict()
  .default({});

const SensorSchema = z
  .object({
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
    /** Free text, not unique, and never auto-generated — absent when unset. */
    name: z.string().optional(),
  })
  .strict();

// `provenance` is a discriminated union with no default. `proposed_by` is
// required on `proposed`/`corrected` and forbidden on `human`, enforced by the
// schema rather than by a downstream runtime check: a default of `human` would
// launder model output as human authorship, which is the exact feedback loop
// provenance exists to make measurable.
const carLabelBase = {
  id: z.string().min(1),
  /**
   * A plain string here, deliberately unvalidated against the vocabulary,
   * which is a corpus rule. Conformance is a warning in the editor and a
   * blocking error in the corpus validator; a format that refused to open files
   * because a class left the vocabulary would punish vocabulary edits.
   */
  class: z.string(),
  p0: PointSchema,
  p1: PointSchema,
};

const CarLabelSchema = z.discriminatedUnion('provenance', [
  z
    .object({
      ...carLabelBase,
      provenance: z.literal('human'),
      // Present-and-set fails; absent passes.
      proposed_by: z.never().optional(),
    })
    .strict(),
  z
    .object({
      ...carLabelBase,
      provenance: z.literal('proposed'),
      proposed_by: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...carLabelBase,
      provenance: z.literal('corrected'),
      proposed_by: z.string().min(1),
    })
    .strict(),
]);

/**
 * Ids are unique **within** a collection. Sensor ids and label ids are separate
 * namespaces and are never compared — an id shared between the two is fine.
 */
function uniqueIds<T extends { id: string }>(kind: string) {
  return {
    check: (items: readonly T[]) => new Set(items.map(i => i.id)).size === items.length,
    // The rule rides on the issue, so parseManifest need not match the message.
    message: {
      message: `duplicate ${kind} id: ids must be unique within their collection`,
      params: { rule: 'format/duplicate-id' satisfies FormatRule },
    },
  };
}

const sensorIds = uniqueIds<z.infer<typeof SensorSchema>>('sensor');
const labelIds = uniqueIds<z.infer<typeof CarLabelSchema>>('label');

const ImageSchema = z
  .object({
    filename: z.string(),
    /**
     * A human asserts that no car in this image is unlabeled. Defaults to
     * `false` unconditionally — that is a claim no default and no conversion can
     * make on a human's behalf. An image marked complete with zero labels is
     * legitimate: it is an all-background sample.
     */
    labeled_complete: z.boolean().default(false),
    labels: z.array(CarLabelSchema).refine(labelIds.check, labelIds.message).default([]),
  })
  .strict();

const LayoutSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    contact: z.string().optional(),
    /**
     * Required, with **no default**. v3 defaulted this to `'N'`, which is not
     * safe here: `DPT = s · gauge_mm(scale)`, so a silently-assumed scale
     * reports a DPT wrong by the ratio between the two scales — up to 8.8×
     * between Z and G. FORMAT.md § The manifest names the only defaults, and
     * this is not one of them.
     */
    scale: ScaleSchema,
    calibration: CalibrationSchema,
    /** Per **layout**, not per image: placing one answers for every frame. */
    sensors: z.array(SensorSchema).refine(sensorIds.check, sensorIds.message).default([]),
  })
  .strict();

const CameraSchema = z
  .object({
    /** Retained because L0 detections are reported in this frame. */
    resolution: z
      .object({
        width: z.number().int(),
        height: z.number().int(),
      })
      .strict(),
    model: z.string().optional(),
  })
  .strict();

export const ManifestDataSchema = z
  .object({
    version: z.literal(MANIFEST_VERSION),
    /**
     * Identity of the archive itself, stable across every save.
     *
     * **Optional at the format layer, required by the corpus repo** — an
     * archive without one is still valid v4, which is what lets a hand-built
     * manifest and every file written before this field existed keep loading.
     * `R49Archive` mints one on write when it is absent and never overwrites
     * one that exists, so a file only lacks an `id` until the first save.
     *
     * It is identity, not an address: the path a file sits at, and its name,
     * may both change without making it a different archive.
     */
    id: z.string().min(1).optional(),
    layout: LayoutSchema,
    camera: CameraSchema,
    images: z.array(ImageSchema).default([]),
  })
  .strict();

/**
 * Validate a manifest, naming the format rule it broke.
 *
 * Every zod failure becomes a {@link FormatError} carrying a FORMAT.md rule id,
 * so a caller never sees zod — the schemas stay replaceable. When several rules
 * are broken at once the one reported is the one most worth acting on: an
 * unknown key first, because it usually means the whole archive is newer.
 *
 * `.strict()` refuses an unknown key rather than stripping it, which is what
 * stops a newer build's file round-tripping through an older one shorter than
 * it arrived. zod states it as `Unrecognized key(s) in object:
 * 'camera_height_mm'`, which is legible to someone holding the schema and
 * useless to a model railroader looking at a file that will not open, so that
 * one message is reworded.
 *
 * It is worth rewording because an additive field adds **no version**
 * (ADR 0001) — so this, and not a version mismatch, is how a stale reader meets
 * a newer archive. A cached bundle is the ordinary way to be behind in a
 * client-side app served from one origin, and "reload the app" is the one thing
 * the reader can act on. Every future additive field inherits the wording.
 *
 * The hedge is not padding: an unknown key is equally a typo in a hand-built
 * manifest, and nothing can tell the two apart.
 *
 * @throws FormatError for any manifest that is not valid v4.
 */
export function parseManifest(data: unknown): ManifestData {
  const result = ManifestDataSchema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.error.issues;
  const rule = RULE_PRIORITY.find(r => issues.some(issue => ruleOf(issue) === r)) ?? 'format/field';

  if (rule === 'format/unknown-key') {
    const unknown = issues.flatMap(issue =>
      issue.code === 'unrecognized_keys'
        ? issue.keys.map(key => [...issue.path, key].join('.'))
        : [],
    );
    const names = unknown.map(k => `\`${k}\``).join(', ');
    throw new FormatError(
      rule,
      `This archive uses ${unknown.length === 1 ? 'a field' : 'fields'} this build does not ` +
        `know (${names}). It may have been written by a newer version of rails49 — reload the ` +
        `app and try again. If you hand-edited manifest.json, check the key ` +
        `${unknown.length === 1 ? 'name' : 'names'}.`,
    );
  }

  throw new FormatError(
    rule,
    issues
      .filter(issue => ruleOf(issue) === rule)
      .map(issue => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; '),
  );
}

/** Which rule to report when a manifest breaks several. */
const RULE_PRIORITY: readonly FormatRule[] = [
  'format/unknown-key',
  'format/provenance',
  'format/duplicate-id',
  'format/field',
];

/** The FORMAT.md rule one zod issue breaks. */
function ruleOf(issue: z.ZodIssue): FormatRule {
  if (issue.code === 'unrecognized_keys') return 'format/unknown-key';
  if (issue.code === 'custom' && issue.params?.rule === 'format/duplicate-id') {
    return 'format/duplicate-id';
  }
  // The label union is the only discriminated union, so a bad or missing
  // discriminator is a bad or missing provenance.
  if (issue.code === 'invalid_union_discriminator' || issue.path.includes('proposed_by')) {
    return 'format/provenance';
  }
  return 'format/field';
}

/**
 * Rejects anything that is not a v4 manifest object with a message that names
 * the version, before the schema gets a chance to report it as one issue among
 * many.
 *
 * @throws FormatError `format/manifest-json` if `data` is not a JSON object,
 *         `format/version` if its `version` is not 4.
 */
export function assertManifestVersion(data: unknown): void {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new FormatError('format/manifest-json', 'manifest.json is not a JSON object');
  }
  const version = (data as { version?: unknown }).version;
  if (version === MANIFEST_VERSION) return;

  throw new FormatError(
    'format/version',
    `Unsupported manifest version ${JSON.stringify(version)}: this build reads version ` +
      `${MANIFEST_VERSION} only. There is no v3 compatibility path — v4 replaced point ` +
      `markers with cars and sensors, and no automated migration is possible because a ` +
      `point carries neither extent nor orientation.`
  );
}

export type Point = z.infer<typeof PointSchema>;
export type WorldPoint = z.infer<typeof WorldPointSchema>;
export type CalibrationPoint = z.infer<typeof CalibrationPointSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type Sensor = z.infer<typeof SensorSchema>;
export type CarLabel = z.infer<typeof CarLabelSchema>;
export type Provenance = CarLabel['provenance'];
export type Image = z.infer<typeof ImageSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type ManifestData = z.infer<typeof ManifestDataSchema>;
