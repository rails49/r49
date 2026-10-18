import data from './data.json' with { type: 'json' };
import type { VocabularyNode } from './vocabulary.ts';

/**
 * The format's constants, read from `data.json` beside this file — their one
 * authored home. This module declares none of them; it only gives the parsed
 * file types the rest of the package can use.
 *
 * A JSON file rather than TypeScript because more than this package reads it:
 * the Python reader loads it with nothing but the standard library, and the
 * corpus validator reads the recommended DPT from it. See ADR 0018.
 */

/** Prototype track gauge in mm. */
export const STANDARD_GAUGE: number = data.standard_gauge;

/**
 * Scale name to reduction ratio (HO is 1:87). Model-domain gauge is
 * `STANDARD_GAUGE / SCALE_TO_RATIO[scale]`.
 */
export const SCALE_TO_RATIO = data.scale_to_ratio;

/** Every scale name the data file defines a ratio for. */
export type Scale = keyof typeof SCALE_TO_RATIO;

/**
 * Scale names as a non-empty tuple, in the data file's order — the form a
 * schema enum needs.
 */
export const SCALES = Object.keys(SCALE_TO_RATIO) as [Scale, ...Scale[]];

/**
 * The vocabulary — what a label's `class` should match.
 *
 * A **nested object is a subtype**; any other value is a property of the class
 * it sits under (`width_mm` is the one such property). The single root is
 * required: every stored class is rooted at it.
 */
export const VOCABULARY: VocabularyNode = data.vocabulary;
