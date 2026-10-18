import data from './r49.json' with { type: 'json' };

/**
 * The data file, read once: `data/r49.json` in the repository, shipped beside
 * this module. This package declares none of these values in code, so the
 * Python package and the corpus validator cannot disagree with it.
 */

/** Prototype track gauge in mm. */
export const STANDARD_GAUGE: number = data.standard_gauge;

/** A scale name. */
export type Scale = keyof typeof data.scale_to_ratio;

/** Scale name to reduction ratio (HO is 1:87), in the data file's order. */
export const SCALE_TO_RATIO: Readonly<Record<Scale, number>> = data.scale_to_ratio;

/** Every scale name as a non-empty tuple, in the data file's order — the form a schema enum needs. */
export const SCALES = Object.keys(SCALE_TO_RATIO) as [Scale, ...Scale[]];

/** The vocabulary tree. A nested object is a subtype; anything else is a property. */
export const VOCABULARY: { readonly [key: string]: unknown } = data.vocabulary;

/** The DPT the corpus asks contributors to reach. A warning threshold, never a refusal. */
export const RECOMMENDED_DPT: number = data.recommended_dpt;

/** Model-domain track gauge in mm: the standard gauge over the scale's ratio. */
export function getGaugeMM(scale: Scale): number {
  return STANDARD_GAUGE / SCALE_TO_RATIO[scale];
}
