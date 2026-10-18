import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { R49Archive, R49Error, RULES, FORMAT_RULES, CORPUS_RULES, type ManifestData } from '../src/index.ts';

// The rule ids this package's own interface decides. What any reader must
// decide the same way, refusing an archive under a rule, is in
// conformance/cases/.

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 4,
    layout: { scale: 'HO', calibration: { points: [] }, sensors: [] },
    camera: { resolution: { width: 1920, height: 1080 } },
    images: [],
    ...overrides,
  };
}

/** The rule `setManifest` names when it refuses `data`. */
function ruleOf(data: unknown): string {
  try {
    new R49Archive().setManifest(data as ManifestData);
  } catch (err) {
    if (err instanceof R49Error) return err.rule;
    throw err;
  }
  throw new Error('expected the manifest to be refused, but it was accepted');
}

describe('the rule set', () => {
  it('is closed: every rule is either a format rule or a corpus rule, never both', () => {
    expect([...RULES].sort()).toEqual([...FORMAT_RULES, ...CORPUS_RULES].sort());
    expect(new Set(RULES).size).toBe(RULES.length);
  });
});

describe('setManifest names the rule it refused on', () => {
  it('manifest/version for a value with no version 4, null included', () => {
    expect(ruleOf({})).toBe('manifest/version');
    expect(ruleOf(null)).toBe('manifest/version');
  });

  it('names the unknown key ahead of any other failure in the same manifest', () => {
    expect(ruleOf(manifest({ vendor_extra: 1, id: '' }))).toBe('manifest/unknown-key');
  });
});
