import data from './data.json' with { type: 'json' };

/**
 * The format's tables, typed. `data.json` holds them so that a reader in any
 * language can load the same numbers this package computes with; FORMAT.md
 * § Scales and gauge and § The vocabulary state them in prose.
 */

/** A scale name. */
export type Scale = 'G' | 'O' | 'S' | 'HO' | 'T' | 'N' | 'Z';

/** The prototype's standard gauge in mm. */
export const STANDARD_GAUGE: number = data.standard_gauge_mm;

/** Scale name to reduction ratio (HO is 1:87). */
export const SCALE_TO_RATIO: Readonly<Record<Scale, number>> = data.scale_ratios;

/** Scale names as a non-empty tuple, in the data file's order — the form a schema enum needs. */
export const SCALES = Object.keys(SCALE_TO_RATIO) as [Scale, ...Scale[]];

/** The authoring taxonomy — what a label's `class` should match. */
export const VOCABULARY: { readonly [key: string]: unknown } = data.vocabulary;

/** The YOLO class list, indexed by a detector's class field. */
export const DETECTOR_CLASSES: readonly string[] = data.detector_classes;
