import { VOCABULARY } from './data.ts';

/**
 * How the class vocabulary is *read*. The vocabulary itself is in `data.json`
 * (and in prose in FORMAT.md § The vocabulary); this module holds only the
 * rules for interpreting it.
 *
 * It lives in this package because its callers must agree: an editor, where a
 * class outside the vocabulary is a visible warning, and the corpus validator,
 * where the same mismatch blocks a submission. A rule implemented twice agrees
 * only until someone edits one copy — and the copies matter *most* where they
 * disagree, because a contributor would then be rejected for a class their
 * editor showed as fine.
 *
 * This is not parse-time validation and must not become it: `class` is a plain
 * string at the format layer, deliberately (FORMAT.md § Car label). A format
 * that refused to open files because someone pruned the vocabulary would punish
 * vocabulary edits.
 */

/**
 * One mapping in the vocabulary: subtypes by name, mixed with the node's own
 * properties.
 *
 * `unknown` rather than a union, because the two are told apart by shape and a
 * property may be any scalar the JSON allows.
 */
export type VocabularyNode = { readonly [key: string]: unknown };

/** The authored vocabulary. A separate name so the default is legible. */
const AUTHORED: VocabularyNode = VOCABULARY;

/**
 * Whether `prefix` matches `cls` **segment by segment** — either the whole
 * class or one of its dotted ancestors.
 *
 * The rule the whole module turns on: `stock` is a prefix of `stock.loco` and
 * of `stock`, but never of `stockyard`. A plain `startsWith` would match the
 * last of those, silently mapping an unrelated class onto a trained index.
 *
 * Exported because a reader that maps classes onto a list of its own, such as
 * a detector's class list, must match by the same rule the vocabulary is read
 * with, or a class could be known here and unmapped there.
 */
export function isSegmentPrefix(prefix: string, cls: string): boolean {
  return cls === prefix || cls.startsWith(`${prefix}.`);
}

/**
 * The subtypes of a node, in authored order — the object-valued keys.
 *
 * **A nested object is a subtype; anything else is a property.** `width_mm` is
 * an optional per-class width override sitting beside subtypes in the same
 * mapping, and telling the two apart *structurally* is what avoids a reserved
 * list of key names that the data file would then have to know about.
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
 * Whether a stored class names an entry of the vocabulary.
 *
 * Matching is **segment by segment** ({@link isSegmentPrefix}): `stockyard`
 * is not `stock` with a suffix, and a property name is not a class. The class
 * is rooted — an unrooted `loco.steam` matches nothing.
 *
 * @param cls The stored `class` string, rooted and dot-separated.
 * @param vocabulary Defaults to the authored vocabulary; injectable for tests.
 */
export function isKnownClass(cls: string, vocabulary: VocabularyNode = AUTHORED): boolean {
  if (cls === '') return false;

  let node: VocabularyNode = vocabulary;
  for (const segment of cls.split('.')) {
    const child = vocabularySubtypes(node).find(([name]) => name === segment)?.[1];
    if (!child) return false;
    node = child;
  }
  return true;
}
