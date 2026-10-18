import { describe, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { R49Archive } from '../src/index.ts';
import { cases, expectMatches } from './cases.ts';

/**
 * The writer, tested at the conformance seam: every accepted bare manifest is
 * written to an archive by this package and read back with the values the case
 * expects.
 *
 * With `R49_WRITE_CASES=<dir>` set, each written archive is also kept there
 * beside its `expected.json`, so the Python package can run the same cases
 * against archives TypeScript wrote (`R49_CONFORMANCE=<dir>`).
 */

const out = process.env.R49_WRITE_CASES;

describe('archives this package writes', () => {
  for (const { name, dir, expected } of cases()) {
    if (!expected.accept || !existsSync(join(dir, 'manifest.json'))) continue;

    it(`round-trips ${name}`, async () => {
      const archive = new R49Archive();
      archive.setManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
      const bytes = await archive.export();
      expectMatches((await R49Archive.load(bytes)).getManifest(), expected);

      if (out !== undefined) {
        mkdirSync(join(out, name), { recursive: true });
        writeFileSync(join(out, name, 'archive.r49'), bytes);
        copyFileSync(join(dir, 'expected.json'), join(out, name, 'expected.json'));
      }
    });
  }
});
