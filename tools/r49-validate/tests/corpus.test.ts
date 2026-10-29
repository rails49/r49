import { describe, it } from 'node:test';
import { expect } from '../../../scripts/test/expect.ts';
import { checkPath, corpusArchives, handleOf, inCorpus, scopeOf } from '../src/corpus.ts';

const codes = (findings: readonly { code: string }[]) => findings.map(f => f.code);

describe('corpus paths', () => {
  describe('the corpus', () => {
    it('is archives/, at any depth', () => {
      expect(inCorpus('archives/alice/west-yard.r49')).toBe(true);
      expect(inCorpus('archives/west-yard.r49')).toBe(true);
      expect(inCorpus('./archives/alice/west-yard.r49')).toBe(true);
    });

    it('leaves out fixtures/, which is no longer part of it', () => {
      expect(inCorpus('fixtures/x.r49')).toBe(false);
      expect(inCorpus('./fixtures/cars-0-10.r49')).toBe(false);
    });

    it('leaves out the conformance cases, which are not submissions', () => {
      expect(inCorpus('conformance/cases/reject-zip-empty/archive.r49')).toBe(false);
      expect(inCorpus('west-yard.r49')).toBe(false);
    });

    it('lists its archives in order, and nothing else', () => {
      const paths = [
        'fixtures/simple.r49',
        'archives/bob/a b.r49',
        'archives/.gitkeep',
        'conformance/cases/accept-minimal/archive.r49',
        'archives/alice/yard/west.r49',
        'README.md',
      ];
      expect(corpusArchives(paths)).toEqual([
        'archives/alice/yard/west.r49',
        'archives/bob/a b.r49',
      ]);
    });
  });

  describe('scope', () => {
    it('recognises a submission', () => {
      expect(scopeOf('archives/alice/west-yard.r49')).toBe('archives');
    });

    it('gives fixtures/ no scope of its own', () => {
      expect(scopeOf('fixtures/x.r49')).toBe('unknown');
    });

    it('refuses depths the layout does not define', () => {
      // No flat submissions, and no per-layout directory: an .r49 is already a
      // self-contained zip, so a directory holding exactly one file buys a
      // level of nesting for nothing.
      expect(scopeOf('archives/west-yard.r49')).toBe('unknown');
      expect(scopeOf('archives/alice/yard/west.r49')).toBe('unknown');
      expect(scopeOf('west-yard.r49')).toBe('unknown');
    });

    it('names the contributor directory only for a real submission', () => {
      expect(handleOf('archives/alice/west-yard.r49')).toBe('alice');
      expect(handleOf('archives/west-yard.r49')).toBeNull();
    });
  });

  describe('the rules', () => {
    it('accepts a well-formed submission from its own author', () => {
      expect(checkPath('archives/alice/west-yard.r49', 'alice')).toEqual([]);
    });

    it('rejects a filename that is not a slug', () => {
      // The concrete hazard: `git diff --name-only` piped into a shell loop
      // splits on the spaces.
      expect(codes(checkPath('archives/alice/cars 0-10.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/West_Yard.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/-west.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/west--yard.r49', 'alice'))).toEqual(['path/slug']);
    });

    it('rejects a submission under somebody else’s handle', () => {
      const findings = checkPath('archives/bob/west-yard.r49', 'alice');
      expect(codes(findings)).toEqual(['path/owner']);
      expect(findings[0].message).toContain('archives/alice/');
    });

    it('skips only the ownership rule when the author is unknown', () => {
      // A contributor running this locally has no pull request to read a
      // handle from; refusing to run would make the tool useless to them.
      expect(checkPath('archives/bob/west-yard.r49', null)).toEqual([]);
      expect(codes(checkPath('archives/bob/cars 0-10.r49', null))).toEqual(['path/slug']);
    });

    it('reports one shape error, not a pile, for a path the layout has no place for', () => {
      const findings = checkPath('west-yard.r49', 'alice');
      expect(codes(findings)).toEqual(['path/shape']);
    });

    it('tolerates backslashes, which a Windows contributor’s tooling produces', () => {
      expect(checkPath('archives\\alice\\west-yard.r49', 'alice')).toEqual([]);
    });
  });
});
