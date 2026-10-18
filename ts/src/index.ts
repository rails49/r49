// Public interface of @rails49/r49.
//
// This file is the package's interface — the only surface consumers may rely
// on. Anything not exported here is internal and may change without notice.
// Per-symbol documentation lives on the declarations in the modules below,
// because TypeScript discards doc comments written on re-export statements.
// The format itself is defined in FORMAT.md; this package implements it.

//── Archive I/O ──────────────────────────────────────────────────────────────
// Read and write .r49 layout archives (a zip of manifest.json + images).
// Manifests are validated against the v4 schema on load; invalid input throws
// a FormatError whose `rule` is a FORMAT.md rule id. There is no v3 path:
// loading anything else fails on the version number.
export { R49Archive } from './archive.ts';
export { FormatError, RULES, type FormatRule } from './errors.ts';

//── Manifest types (v4) ──────────────────────────────────────────────────────
// The shape of a parsed manifest, as returned by R49Archive.getManifest().
//
// Two geometries, differing in scope and in whether a model ever sees them:
// a CarLabel is two points along a car's centerline, per image, and carries
// provenance; a Sensor is a single query point, per layout, and carries none.
export type {
  ManifestData,
  Layout,
  Camera,
  Image,
  CarLabel,
  Provenance,
  Sensor,
  Calibration,
  CalibrationPoint,
  Point,
  WorldPoint,
} from './manifest.schema.ts';

// The format version, separate from this package's own semver version.
export { MANIFEST_VERSION } from './manifest.schema.ts';

//── Scales, gauge and the data file ──────────────────────────────────────────
// Read from data/r49.json, which ships beside this module (and as the
// `@rails49/r49/r49.json` subpath, for tooling that wants the raw file).
// Nothing here is declared in code.
export { VALID_SCALES, type ValidScales } from './manifest.schema.ts';
export {
  STANDARD_GAUGE,
  SCALE_TO_RATIO,
  VOCABULARY,
  RECOMMENDED_DPT,
  type Scale,
} from './data.ts';

//── Calibration fit ──────────────────────────────────────────────────────────
// One result: DPT, residual, the pairs used, the points left out and why, and
// whether the camera height fits. getDPT and getDPTResidual read from it, so
// every reader agrees on what "does not resolve" means.
export {
  calibrationFit,
  getDPT,
  getDPTResidual,
  type CalibrationFit,
  type CalibrationPair,
  type LeftOutPoint,
  type LeftOutReason,
} from './fit.ts';

//── Class vocabulary ─────────────────────────────────────────────────────────
// How the vocabulary is read. Not parse-time validation — `class` stays a plain
// string at the format level; the vocabulary is a corpus rule. The
// segment-prefix rule is exported so a reader mapping classes onto its own
// labels (the occupancy detector's class index) applies the same one.
export {
  isKnownClass,
  isSegmentPrefix,
  vocabularySubtypes,
  type VocabularyNode,
} from './vocabulary.ts';

//── ID generation ────────────────────────────────────────────────────────────
// Time-ordered, collision-resistant 11-character identifiers. How this writer
// mints ids; the format asks only for a non-empty string.
export { make_id } from './uid.ts';

// Withheld: the zod schemas (ManifestDataSchema, PointSchema, LayoutSchema,
// …). Exporting them would make zod part of this package's contract, so it
// could not be replaced without a breaking change. Validation is an
// implementation detail — callers get validated data or a FormatError.
//
// Withheld: assertManifestVersion and parseManifest. They are the guards
// R49Archive applies, not public predicates — callers that want to know whether
// bytes are loadable should try to load them.
//
// Withheld: toBase62, a numeric encoding helper. Exporting it invites callers to
// mint ids that bypass the timestamp/node/sequence structure make_id guarantees.
