import { describe, it, expect } from 'vitest';
import { FormatError, RULES } from '../src/index.ts';
import { cases, expectMatches, loadCase } from './cases.ts';

/**
 * Every conformance case, against this package's public interface. The
 * Python package walks the same directory.
 */

describe('conformance', () => {
  it('finds the cases', () => {
    expect(cases().length).toBeGreaterThan(1);
  });

  for (const { name, dir, expected } of cases()) {
    it(name, async () => {
      if (expected.accept) {
        expectMatches(await loadCase(dir), expected);
        return;
      }

      const err = await loadCase(dir).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(FormatError);
      expect((RULES as readonly string[]).includes((err as FormatError).rule)).toBe(true);
      expect((err as FormatError).rule).toBe(expected.rule);
    });
  }
});
