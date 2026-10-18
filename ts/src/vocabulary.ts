import { VOCABULARY } from './data.ts';

/**
 * How the vocabulary is *read*. The vocabulary itself is authored in
 * `data/r49.json`; this module holds only the two rules for interpreting it.
 *
 * It lives in this package because its readers must agree: the editor, where a
 * non-conforming class is a visible warning, and the corpus validator, where
 * the same mismatch blocks a submission. A rule implemented twice agrees only
 * until someone edits one copy — and a contributor would then be rejected for a
 * class the editor drew as fine.
 *
 * This is not parse-time validation and must not become it: `class` is a plain
 * string at the format level, and the vocabulary is a corpus rule
 * (FORMAT.md § The vocabulary). A format that refused to open files because a
 * class left the vocabulary would punish vocabulary edits.
 */

/**
 * One node of the vocabulary: subtypes by name, mixed with the node's own
 * properties.
 *
 * `unknown` rather than a union, because the two are told apart by shape and a
 * property may be any JSON value that is not an object.
 */
export type VocabularyNode = { readonly [key: string]: unknown };

/**
 * Whether `prefix` matches `cls` **segment by segment** — either the whole
 * class or one of its dotted ancestors.
 *
 * The rule the vocabulary turns on: `stock` is a prefix of `stock.loco` and of
 * `stock`, but never of `stockyard`. A plain `startsWith` would match the last
 * of those. Exported so a reader mapping classes onto its own labels — the
 * occupancy detector's class index, say — applies the same rule.
 */
export function isSegmentPrefix(prefix: string, cls: string): boolean {
  return cls === prefix || cls.startsWith(`${prefix}.`);
}

/**
 * The subtypes of a node, in authored order — the object-valued keys.
 *
 * **A nested object is a subtype; anything else is a property.** A property,
 * such as a per-class `width_mm`, sits beside subtypes in one mapping, and telling
 * the two apart *structurally* is what avoids a reserved list of key names.
 */
export function vocabularySubtypes(
  node: VocabularyNode
): readonly (readonly [string, VocabularyNode])[] {
  return Object.entries(node).filter(
    (entry): entry is [string, VocabularyNode] =>
      typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1])
  );
}

/**
 * Whether a stored class names a node of the vocabulary.
 *
 * Matching is **segment by segment**, the rule {@link isSegmentPrefix} states:
 * `stockyard` is not `stock` with a suffix, and a property name is not a
 * class. The class is rooted — an unrooted `loco.steam` matches nothing.
 *
 * @param cls The stored `class` string, rooted and dot-separated.
 * @param vocabulary Defaults to the vocabulary in the data file.
 */
export function isKnownClass(cls: string, vocabulary: VocabularyNode = VOCABULARY): boolean {
  if (cls === '') return false;

  let node: VocabularyNode = vocabulary;
  for (const segment of cls.split('.')) {
    const child = vocabularySubtypes(node).find(([name]) => name === segment)?.[1];
    if (!child) return false;
    node = child;
  }
  return true;
}
