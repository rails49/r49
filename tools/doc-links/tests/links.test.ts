import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from '../../../scripts/test/expect.ts';
import { anchors, brokenLinks, github, links, pages, type GitHub } from '../src/links.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A directory holding the given pages, path to text. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'doc-links-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A GitHub API that answers the given paths and 404s the rest. */
function fakeGitHub(answers: Record<string, string>): GitHub & { asked: string[] } {
  const asked: string[] = [];
  const api = async (path: string) => {
    asked.push(path);
    return answers[path] ?? null;
  };
  return Object.assign(api, { asked });
}

const none = fakeGitHub({});

describe('anchors', () => {
  it('drops what is not a letter, digit, space or hyphen, then hyphenates spaces', () => {
    expect([...anchors('## The `layout.calibration` key\n### Car label')]).toEqual([
      'the-layoutcalibration-key',
      'car-label',
    ]);
  });

  it('derives layoutcalibration from FORMAT.md', () => {
    const format = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8');
    expect(format).toContain('### `layout.calibration`');
    expect(anchors(format).has('layoutcalibration')).toBe(true);
  });
});

describe('links', () => {
  it('reads inline and reference-style links with their line', () => {
    const text = 'See [a](a.md) and [b](b.md#x).\n\n[c]: https://example.com\n';
    expect(links(text)).toEqual([
      { line: 1, target: 'a.md' },
      { line: 1, target: 'b.md#x' },
      { line: 3, target: 'https://example.com' },
    ]);
  });
});

describe('brokenLinks', () => {
  it('passes links that land', async () => {
    const root = tree({
      'README.md': '# Top\n\n[d](docs/d.md#two) [self](#top) [dir](docs/) [r]\n\n[r]: docs/d.md\n',
      'docs/d.md': '# One\n## Two\n',
    });
    expect(await brokenLinks(root, ['README.md', 'docs/d.md'], none)).toEqual([]);
  });

  it('reports a missing file, heading and bare fragment as file:line: reason: target', async () => {
    const root = tree({
      'README.md': '# Top\n[a](missing.md)\n[b](docs/d.md#three)\n[c]: #nowhere\n',
      'docs/d.md': '# One\n',
    });
    expect(await brokenLinks(root, ['README.md'], none)).toEqual([
      'README.md:2: no such file: missing.md',
      'README.md:3: no such heading: docs/d.md#three',
      'README.md:4: no such heading: #nowhere',
    ]);
  });

  it('resolves a relative link against its own page', async () => {
    const root = tree({ 'docs/a.md': '[up](../README.md) [side](b.md)\n', 'README.md': '', 'docs/b.md': '' });
    expect(await brokenLinks(root, ['docs/a.md'], none)).toEqual([]);
  });

  it('does not read other web links or mail links', async () => {
    const root = tree({ 'README.md': '[a](https://example.com/x) [b](http://x.org) [c](mailto:a@b.c)\n' });
    expect(await brokenLinks(root, ['README.md'], none)).toEqual([]);
    expect(none.asked).toEqual([]);
  });

  it('reports a missing rails49 repository', async () => {
    const root = tree({ 'README.md': '[a](https://github.com/rails49/gone)\n[b](https://github.com/rails49/r49/)\n' });
    const api = fakeGitHub({ '/repos/rails49/r49': '{}' });
    expect(await brokenLinks(root, ['README.md'], api)).toEqual([
      'README.md:1: no such repository: https://github.com/rails49/gone',
    ]);
  });

  it('reports a missing rails49 file, trying each split of ref and path', async () => {
    const root = tree({
      'README.md': [
        '[a](https://github.com/rails49/r49/blob/main/GONE.md)',
        '[b](https://github.com/rails49/r49/blob/feature/x/FORMAT.md#image)',
        '[c](https://github.com/rails49/r49/tree/main/docs)',
      ].join('\n'),
    });
    const api = fakeGitHub({
      '/repos/rails49/r49/contents/FORMAT.md?ref=feature%2Fx': '## Image\n',
      '/repos/rails49/r49/contents/docs?ref=main': '[]',
    });
    expect(await brokenLinks(root, ['README.md'], api)).toEqual([
      'README.md:1: no such file: https://github.com/rails49/r49/blob/main/GONE.md',
    ]);
    expect(api.asked).toContain('/repos/rails49/r49/contents/x/FORMAT.md?ref=feature');
  });

  it('reports a missing heading in a rails49 Markdown file', async () => {
    const root = tree({ 'README.md': '[a](https://github.com/rails49/r49/blob/main/FORMAT.md#gone)\n' });
    const api = fakeGitHub({ '/repos/rails49/r49/contents/FORMAT.md?ref=main': '## Image\n' });
    expect(await brokenLinks(root, ['README.md'], api)).toEqual([
      'README.md:1: no such heading: https://github.com/rails49/r49/blob/main/FORMAT.md#gone',
    ]);
  });

  it('does not read rails49 issue and pull request links', async () => {
    const root = tree({
      'README.md': '[a](https://github.com/rails49/r49/issues/1) [b](https://github.com/rails49/r49/pull/2)\n',
    });
    const api = fakeGitHub({});
    expect(await brokenLinks(root, ['README.md'], api)).toEqual([]);
    expect(api.asked).toEqual([]);
  });
});

describe('github', () => {
  const respond = (status: number, body = '') => async () => new Response(body, { status });

  it('answers a file as its text and a 404 as null', async () => {
    expect(await github(undefined, respond(200, 'text'))('/x')).toBe('text');
    expect(await github(undefined, respond(404))('/x')).toBeNull();
  });

  it('fails on any other answer, saying it is not about the link', async () => {
    const error = await github(undefined, respond(403))('/x').catch((e: Error) => e);
    expect((error as Error).message).toMatch(/not about the link/);
  });

  it('sends the token when there is one', async () => {
    let auth: string | null = null;
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('Authorization');
      return new Response('');
    };
    await github('t0ken', fetch)('/x');
    expect(auth).toBe('Bearer t0ken');
  });
});

describe('the pages', () => {
  const list = pages(ROOT);

  it('are the tracked Markdown files outside .implement-loop/', () => {
    expect(list).toContain('FORMAT.md');
    expect(list).toContain('docs/agents/domain.md');
    expect(list.some(page => page.startsWith('.implement-loop/'))).toBe(false);
  });

  it('carry more than 50 links', () => {
    const count = list.reduce((n, page) => n + links(readFileSync(join(ROOT, page), 'utf8')).length, 0);
    expect(count).toBeGreaterThan(50);
  });

  it('link only to places that exist', async () => {
    const broken = await brokenLinks(ROOT, list, github(process.env.GITHUB_TOKEN));
    assert.ok(broken.length === 0, `links that go nowhere:\n${broken.join('\n')}`);
  });
});
