import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

/**
 * Every Markdown link in the repository goes somewhere: a relative file, a
 * heading, or a rails49 repository or file read through GitHub's REST API
 * (org ADR-0017). Ported from rails49/control's
 * tests/system/test_doc_links_resolve.py.
 */

/** What GitHub's REST API answers at a path: a file as its text, a 404 as null. */
export type GitHub = (path: string) => Promise<string | null>;

const INLINE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const REFERENCE = /^ {0,3}\[[^\]]+\]:\s*(\S+)/;
const HEADING = /^#{1,6} +(.+?)\s*$/gm;
const NOT_READ = ['http://', 'https://', 'mailto:'];
const RAILS49 = 'https://github.com/rails49/';

/** The tracked Markdown files, except .implement-loop/. */
export function pages(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(page => page && !page.startsWith('.implement-loop/'));
}

/** Each inline and reference-style link's target, with its 1-based line. */
export function links(text: string): { line: number; target: string }[] {
  return text.split('\n').flatMap((content, i) => {
    const targets = [...content.matchAll(INLINE)].map(m => m[1]);
    const reference = REFERENCE.exec(content);
    if (reference) targets.push(reference[1]);
    return targets.map(target => ({ line: i + 1, target }));
  });
}

/**
 * The fragment each heading answers to: lowercased, everything but letters,
 * digits, spaces and hyphens dropped, spaces turned into hyphens.
 */
export function anchors(text: string): Set<string> {
  return new Set(
    [...text.matchAll(HEADING)].map(m => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replaceAll(' ', '-')),
  );
}

/** A GitHub API reader that caches each path and sends the token if there is one. */
export function github(token: string | undefined, fetchFn: typeof fetch = fetch): GitHub {
  const cache = new Map<string, Promise<string | null>>();
  const read = async (path: string) => {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.raw' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetchFn(`https://api.github.com${path}`, { headers });
    } catch (error) {
      throw new Error(`GitHub API failed at ${path}, not about the link: ${error}`);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub API answered ${response.status} at ${path}, not about the link`);
    }
    return response.text();
  };
  return path => {
    if (!cache.has(path)) cache.set(path, read(path));
    return cache.get(path)!;
  };
}

/** Why a relative link or bare fragment goes nowhere, or null where it lands. */
function relativeProblem(root: string, page: string, target: string): string | null {
  const [path, anchor] = splitAnchor(target);
  const landed = path ? join(root, dirname(page), path) : join(root, page);
  if (!existsSync(landed)) return 'no such file';
  if (anchor && extname(landed) === '.md' && !anchors(readFileSync(landed, 'utf8')).has(anchor)) {
    return 'no such heading';
  }
  return null;
}

/**
 * Why a link into a rails49 repository goes nowhere, or null where it lands.
 * A ref may hold a slash, so a blob or tree link is tried at each split of
 * ref from path. Links of any other shape are not read.
 */
async function rails49Problem(target: string, api: GitHub): Promise<string | null> {
  const [address, anchor] = splitAnchor(target.slice(RAILS49.length));
  const [repo, kind, ...segments] = address.replace(/\/+$/, '').split('/');
  if (kind === undefined) {
    return (await api(`/repos/rails49/${repo}`)) === null ? 'no such repository' : null;
  }
  if ((kind !== 'blob' && kind !== 'tree') || segments.length === 0) return null;
  for (let split = 1; split <= segments.length; split++) {
    const ref = encodeURIComponent(segments.slice(0, split).join('/'));
    const path = segments.slice(split).join('/');
    const text = await api(`/repos/rails49/${repo}/contents/${path}?ref=${ref}`);
    if (text === null) continue;
    return anchor && path.endsWith('.md') && !anchors(text).has(anchor) ? 'no such heading' : null;
  }
  return 'no such file';
}

function splitAnchor(target: string): [string, string] {
  const i = target.indexOf('#');
  return i < 0 ? [target, ''] : [target.slice(0, i), target.slice(i + 1)];
}

/** Each link on the pages that goes nowhere, as `file:line: reason: target`. */
export async function brokenLinks(root: string, files: string[], api: GitHub): Promise<string[]> {
  const broken: string[] = [];
  for (const page of files) {
    for (const { line, target } of links(readFileSync(join(root, page), 'utf8'))) {
      let problem: string | null = null;
      if (target.startsWith(RAILS49)) problem = await rails49Problem(target, api);
      else if (!NOT_READ.some(prefix => target.startsWith(prefix))) problem = relativeProblem(root, page, target);
      if (problem) broken.push(`${page}:${line}: ${problem}: ${target}`);
    }
  }
  return broken;
}
