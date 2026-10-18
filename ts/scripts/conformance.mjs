// Runs every conformance case against an *installed* @rails49/r49, so a
// package that builds but ships without its data file, or without a module the
// source tree happened to resolve, fails before it is published. Plain
// JavaScript with no dependencies but the package: copy it into a directory
// where `npm install <tarball>` ran, and run it there.
//
//   node conformance.mjs <conformance-dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FormatError, R49Archive, RECOMMENDED_DPT, calibrationFit } from '@rails49/r49';
import data from '@rails49/r49/r49.json' with { type: 'json' };

const root = process.argv[2];
if (!root) {
  console.error('usage: node conformance.mjs <conformance-dir>');
  process.exit(2);
}

const failures = [];
const fail = (name, why) => failures.push(`${name}: ${why}`);

if (data.recommended_dpt !== RECOMMENDED_DPT) fail('data', 'r49.json and the package disagree');

async function load(dir) {
  const archive = join(dir, 'archive.r49');
  if (existsSync(archive)) return (await R49Archive.load(readFileSync(archive))).getManifest();
  const r49 = new R49Archive();
  r49.setManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  return r49.getManifest();
}

const close = (a, b, tol) => (a === null || b === null ? a === b : Math.abs(a - b) <= tol);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let count = 0;
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name);
  if (!existsSync(join(dir, 'expected.json'))) continue;
  count++;
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

  let manifest;
  try {
    manifest = await load(dir);
  } catch (err) {
    if (expected.accept) fail(name, `refused: ${err}`);
    else if (!(err instanceof FormatError)) fail(name, `threw ${err}, not a FormatError`);
    else if (err.rule !== expected.rule) fail(name, `rule ${err.rule}, expected ${expected.rule}`);
    continue;
  }
  if (!expected.accept) {
    fail(name, `accepted, expected ${expected.rule}`);
    continue;
  }
  if (expected.id !== undefined && manifest.id !== expected.id) fail(name, `id ${manifest.id}`);
  const want = expected.fit;
  if (want === undefined) continue;
  const fit = calibrationFit(manifest);
  if (!close(fit.dpt, want.dpt, want.tolerance)) fail(name, `dpt ${fit.dpt}`);
  if (!close(fit.residual, want.residual, want.tolerance)) fail(name, `residual ${fit.residual}`);
  if (!same(fit.pairs.map(p => [p.a, p.b]), want.pairs)) fail(name, 'pairs');
  if (!same(fit.leftOut, want.left_out)) fail(name, 'left out');
  if (fit.cameraHeightFits !== want.camera_height_fits) fail(name, 'camera height fits');
}

if (count === 0) fail(root, 'no cases found');
for (const f of failures) console.error(f);
console.error(`${count} case(s), ${failures.length} failure(s).`);
process.exitCode = failures.length === 0 ? 0 : 1;
