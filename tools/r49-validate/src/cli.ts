import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { parseArgs } from 'node:util';
import { readContents, validate, type ArchiveInput, type Contents } from './validate.ts';
import { checkGuidance, guidanceTable, REFERENCE_WIDTH_PX } from './guidance.ts';
import { CORPUS_DIRECTORIES, corpusArchives, inCorpus } from './corpus.ts';
import { readerDisagreements, readOutcome, type ReaderOutcome } from './readers.ts';
import type { ArchiveReport, Change, Report } from './report.ts';

/**
 * The only impure module: reads files, writes streams, chooses an exit code.
 * Everything it decides with lives in `validate.ts`, `corpus.ts` and
 * `guidance.ts`, which are pure and therefore testable.
 *
 * **stdout is machine, stderr is human — always both, with no flag.** The
 * corpus workflow pipes stdout through `jq` to make its `::warning` annotations
 * and its job summary; a person running the same command reads stderr. One code
 * path serves both, so the rendering nobody tests cannot drift from the one
 * that matters.
 *
 * Exit codes:
 *
 * * **0** — no blocking errors. Warnings do not change this; that is what makes
 *   the bar soft rather than merely lenient.
 * * **1** — at least one archive carries a blocking error.
 * * **2** — the tool itself failed: bad arguments, an unreadable path, a bug.
 *   Distinct from 1 on purpose. A crash here must never read as "your archive
 *   is bad" to a contributor who did nothing wrong.
 */

const USAGE = `
r49-validate <path>...            validate submitted .r49 files
r49-validate guidance             print the capture-guidance table
r49-validate guidance --check <path>
                                  check a document's generated block against it
r49-validate readers --python <report.json> <path>...
                                  compare read.py's outcomes with this package's
r49-validate list [<path>...]     print the corpus archives, each ending in NUL:
                                  those in archives/, or those among <path>...

Options:
  --author <handle>   the pull request author, for the directory-ownership rule
  --base <ref>        the git commit before the submission, for what an update changed
  --check <path>      guidance only; verify instead of print. Exit 1 on drift.
  --python <path>     readers only; the JSON read.py wrote. Exit 1 on any difference.
  --width <px>        guidance only; reference frame width (default ${REFERENCE_WIDTH_PX})
`.trim();

/** Every corpus archive in the working tree. */
async function corpusPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (const directory of CORPUS_DIRECTORIES) {
    const entries = await readdir(directory, { recursive: true });
    paths.push(...entries.map(entry => join(directory, entry)));
  }
  return corpusArchives(paths);
}

/** The corpus in the working tree, without the submitted paths. */
async function corpusBeside(submitted: readonly string[]): Promise<Contents[]> {
  const skip = new Set(submitted);
  const corpus: Contents[] = [];
  for (const path of await corpusPaths()) {
    if (skip.has(path)) continue;
    const contents = await readContents({ path, bytes: await readFile(path) });
    if (contents) corpus.push(contents);
  }
  return corpus;
}

/** The corpus at a git commit, read from git so no checkout of it is needed. */
async function corpusAt(ref: string): Promise<Contents[]> {
  const listing = execFileSync('git', [
    'ls-tree', '-r', '-z', '--name-only', ref, '--', ...CORPUS_DIRECTORIES,
  ]).toString('utf8');
  const corpus: Contents[] = [];
  for (const path of corpusArchives(listing.split('\0').filter(p => p !== ''))) {
    const bytes = execFileSync('git', ['cat-file', 'blob', `${ref}:${path}`], {
      maxBuffer: 1 << 30,
    });
    const contents = await readContents({ path, bytes });
    if (contents) corpus.push(contents);
  }
  return corpus;
}

/** What an update changed, in a few words. */
function changeText(change: Extract<Change, { kind: 'update' }>): string {
  const parts = [
    change.added > 0 ? `${change.added} added` : '',
    change.removed > 0 ? `${change.removed} removed` : '',
    change.renamed > 0 ? `${change.renamed} renamed` : '',
    change.replaced > 0 ? `${change.replaced} replaced` : '',
    change.relabeled > 0 ? `${change.relabeled} relabeled` : '',
    change.completed > 0 ? `${change.completed} newly complete` : '',
    change.uncompleted > 0 ? `${change.uncompleted} no longer complete` : '',
    change.calibration ? 'calibration changed' : '',
  ].filter(part => part !== '');
  return parts.length === 0 ? 'nothing changed' : parts.join(', ');
}

/** One archive's findings, for a person. */
function humanLines(report: ArchiveReport): string[] {
  const lines: string[] = [];
  const facts =
    report.images === null
      ? 'did not load'
      : `${report.images} images, ${report.labels} labels, ` +
        `DPT ${report.dpt === null ? '—' : report.dpt.toFixed(1)}` +
        `${report.dptResidual === null ? '' : ` (residual ${report.dptResidual.toFixed(1)} px)`}`;

  lines.push(`${report.errors.length === 0 ? '✅' : '❌'} ${report.path} — ${facts}`);
  // Geometry on its own line, and only when there is something to say. A
  // maintainer triaging a submission wants "shot from 0.8 m over a 2 m layout"
  // at a glance; nothing here is thresholded, so it never changes the verdict.
  if (report.cameraHeightMM !== null) {
    const obliquity =
      report.obliquityDeg === null || report.widthInflation === null
        ? ''
        : `, worst obliquity ${report.obliquityDeg.toFixed(0)}° ` +
          `(cars up to ${report.widthInflation.toFixed(1)}× their nadir width)`;
    lines.push(
      `   camera  ${report.cameraHeightMM} mm above layout zero` +
        `${report.referenceHeightMM === null ? '' : `, railhead at ${report.referenceHeightMM} mm`}` +
        obliquity,
    );
  }
  if (report.change?.kind === 'update') {
    lines.push(`   update  of ${report.change.from}: ${changeText(report.change)}`);
  }
  for (const error of report.errors) lines.push(`   error   ${error.message}`);
  for (const warning of report.warnings) lines.push(`   warning ${warning.message}`);
  return lines;
}

function humanReport(report: Report): string {
  const lines = report.archives.flatMap(humanLines);
  const errors = report.archives.reduce((n, a) => n + a.errors.length, 0);
  const warnings = report.archives.reduce((n, a) => n + a.warnings.length, 0);
  lines.push(
    '',
    `${report.archives.length} archive(s): ${errors} blocking error(s), ${warnings} warning(s).`
  );
  return lines.join('\n');
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === 'list') {
    const paths = argv.length > 1 ? corpusArchives(argv.slice(1)) : await corpusPaths();
    for (const path of paths) process.stdout.write(`${path}\0`);
    return 0;
  }

  if (argv[0] === 'guidance') {
    const { values } = parseArgs({
      args: [...argv.slice(1)],
      options: { width: { type: 'string' }, check: { type: 'string' } },
    });
    const width = values.width === undefined ? REFERENCE_WIDTH_PX : Number(values.width);
    if (!Number.isFinite(width) || width <= 0) {
      process.stderr.write(`--width must be a positive number, got ${values.width}\n`);
      return 2;
    }

    // `--check` reports on stderr like every other human-facing rendering here,
    // and writes nothing to stdout: no program reads it, and stdout
    // carrying the table would tempt a workflow into diffing it a second time.
    if (values.check !== undefined) {
      const { ok, message } = checkGuidance(await readFile(values.check, 'utf8'), width);
      process.stderr.write(`${values.check}: ${message}\n`);
      return ok ? 0 : 1;
    }

    process.stdout.write(guidanceTable(width) + '\n');
    return 0;
  }

  if (argv[0] === 'readers') {
    const { values, positionals } = parseArgs({
      args: [...argv.slice(1)],
      options: { python: { type: 'string' } },
      allowPositionals: true,
    });
    if (values.python === undefined) {
      process.stderr.write(USAGE + '\n');
      return 2;
    }

    const python = JSON.parse(await readFile(values.python, 'utf8')) as ReaderOutcome[];
    const typescript: ReaderOutcome[] = [];
    for (const path of positionals) {
      typescript.push(await readOutcome({ path, bytes: await readFile(path) }));
    }

    const disagreements = readerDisagreements(typescript, python);
    for (const line of disagreements) process.stderr.write(`❌ ${line}\n`);
    process.stderr.write(
      `${typescript.length} archive(s): the Python and TypeScript packages ` +
        `${disagreements.length === 0 ? 'agree' : `disagree ${disagreements.length} time(s)`}.\n`
    );
    return disagreements.length === 0 ? 0 : 1;
  }

  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      author: { type: 'string' },
      base: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    process.stderr.write(USAGE + '\n');
    return values.help ? 0 : 2;
  }

  // Only archives/ is the corpus. Anything else, such as the
  // conformance cases, is not a submission and is not judged as one.
  // Normalised, so `./archives/...` is the same path the corpus listing gives.
  const paths = positionals.filter(inCorpus).map(normalize);
  for (const path of positionals.filter(p => !inCorpus(p))) {
    process.stderr.write(`skipped ${path}: not under archives/\n`);
  }

  const submitted: ArchiveInput[] = [];
  for (const path of paths) {
    submitted.push({ path, bytes: await readFile(path) });
  }

  const report = await validate(submitted, {
    author: values.author ?? null,
    corpus: await corpusBeside(paths),
    base: values.base === undefined ? null : await corpusAt(values.base),
  });

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.stderr.write(humanReport(report) + '\n');
  return report.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  err => {
    // Exit 2, never 1: this is the tool failing, not an archive being rejected.
    process.stderr.write(`r49-validate failed: ${err?.stack ?? err}\n`);
    process.exitCode = 2;
  }
);
