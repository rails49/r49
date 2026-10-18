import { describe, it, expect } from 'vitest';
import { VOCABULARY, isKnownClass, isSegmentPrefix, vocabularySubtypes } from '../src/index.ts';

// The same questions python/tests/test_vocabulary.py asks, so the two packages
// read the data file's vocabulary identically.

describe('the vocabulary', () => {
  it('knows rooted classes, matched segment by segment', () => {
    expect(isKnownClass('stock')).toBe(true);
    expect(isKnownClass('stock.loco.steam')).toBe(true);
    expect(isKnownClass('stock.freight')).toBe(true);
    expect(isKnownClass('loco.steam')).toBe(false);
    expect(isKnownClass('stockyard')).toBe(false);
    expect(isKnownClass('stock.loco.steam.2-8-0')).toBe(false);
    expect(isKnownClass('')).toBe(false);
  });

  it('tells a property from a subtype by shape', () => {
    const vocabulary = { stock: { width_mm: 3200, loco: {} } };
    expect(vocabularySubtypes(vocabulary.stock).map(([name]) => name)).toEqual(['loco']);
    expect(isKnownClass('stock.loco', vocabulary)).toBe(true);
    expect(isKnownClass('stock.width_mm', vocabulary)).toBe(false);
  });

  it('gives subtypes in authored order', () => {
    const [[, stock]] = vocabularySubtypes(VOCABULARY);
    expect(vocabularySubtypes(stock).map(([name]) => name)).toEqual(['loco', 'passenger', 'freight']);
  });

  it('states the segment-prefix rule', () => {
    expect(isSegmentPrefix('stock', 'stock')).toBe(true);
    expect(isSegmentPrefix('stock', 'stock.loco')).toBe(true);
    expect(isSegmentPrefix('stock', 'stockyard')).toBe(false);
    expect(isSegmentPrefix('stock.loco', 'stock')).toBe(false);
  });
});
