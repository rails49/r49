import { VALID_SCALES, type ValidScales } from '@rails49/r49';
import data from '@rails49/r49/data.json' with { type: 'json' };

/**
 * The capture-guidance table `CONTRIBUTING.md` carries: the widest strip of
 * track that may span a reference frame and still reach the recommended DPT.
 *
 * **Printed, never typed.** The recommended DPT lives in `@rails49/r49`'s
 * `data.json`, beside the scale table it is computed with, so a table
 * hand-written into `CONTRIBUTING.md` would be that number living in two places
 * with nothing checking that they agree. CI diffs the committed prose against
 * this output, which is why it is emitted in a fixed column order with fixed
 * rounding: a diff against prose is only useful when the output is
 * deterministic.
 *
 * ```
 * DPT          = px_per_mm × gauge_mm
 * gauge_mm     = standard_gauge / scale_to_ratio[scale]
 * max_frame_mm = width_px × gauge_mm / recommended_dpt
 * ```
 */

/** The DPT the corpus asks contributors to reach. A submission below it is warned, never refused. */
export const RECOMMENDED_DPT: number = data.recommended_dpt;

/** The prototype's standard gauge in mm. */
const STANDARD_GAUGE: number = data.standard_gauge;

/** Scale name to reduction ratio (HO is 1:87). */
const SCALE_TO_RATIO: Readonly<Record<ValidScales, number>> = data.scale_to_ratio;

/**
 * The reference frame the committed table is computed for.
 *
 * 1920 is what every image in the corpus is today and what a plain 1080p frame
 * gives. The numbers scale linearly with width, so a contributor shooting wider
 * may print their own table — but the committed guidance stays the conservative
 * one, because a bar set from the best-case camera is a bar that anyone
 * shooting at 1080p reads and then misses by half.
 */
export const REFERENCE_WIDTH_PX = 1920;

/** The widest strip of track, in mm, that may span a frame of `widthPx`. */
export function maxFrameMM(scale: ValidScales, widthPx: number): number {
  return (widthPx * gaugeMM(scale)) / RECOMMENDED_DPT;
}

/** The track gauge in mm at a scale. */
export function gaugeMM(scale: ValidScales): number {
  return STANDARD_GAUGE / SCALE_TO_RATIO[scale];
}

/**
 * The table, as markdown, ready to paste between the generated-block markers in
 * `CONTRIBUTING.md`.
 *
 * The reference width is stated **in the output** because it is an input to
 * every number below it, not a constant — a reader who does not know which
 * frame the table describes cannot use it.
 */
export function guidanceTable(widthPx: number = REFERENCE_WIDTH_PX): string {
  const lines = [
    `Reference frame: **${widthPx} px** wide. Minimum DPT: **${RECOMMENDED_DPT}**.`,
    '',
    '| Scale | Ratio | Track gauge | Widest track that may span the frame |',
    '| :--- | ---: | ---: | ---: |',
  ];

  for (const scale of VALID_SCALES) {
    const frameMM = maxFrameMM(scale, widthPx);
    lines.push(
      `| ${scale} | 1:${SCALE_TO_RATIO[scale]} | ${gaugeMM(scale).toFixed(2)} mm | ` +
        `${frameMM.toFixed(0)} mm (${(frameMM / 1000).toFixed(2)} m) |`
    );
  }

  lines.push(
    '',
    'Shoot a **narrower** strip than the figure for your scale and you are above the minimum;',
    'shoot a wider one and cars are too few pixels across to localise reliably. The numbers',
    `scale linearly with image width — at ${widthPx * 2} px they double.`
  );

  return lines.join('\n');
}

/**
 * The markers `CONTRIBUTING.md` wraps the generated block in.
 *
 * The opening marker sits inside an HTML comment that also carries the command
 * that produces the block, so it spans several lines; the block itself starts
 * after that comment closes.
 */
const GENERATED_BEGIN = 'BEGIN GENERATED';
const GENERATED_END = 'END GENERATED';

/** The command that prints the block, as the failure message and `CONTRIBUTING.md` quote it. */
export const GUIDANCE_COMMAND = 'pnpm --silent --filter @rails49/r49-validate guidance';

/** CRLF and trailing spaces are noise; a Windows contributor must not fail on them. */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * The generated block out of a markdown document, or `null` when the markers
 * are missing or out of order.
 *
 * Blank padding either side of the block is not part of it — the markers are a
 * comment, and how much air a document leaves around a comment is prose.
 */
export function extractGeneratedBlock(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  const beginAt = lines.findIndex(line => line.includes(GENERATED_BEGIN));
  if (beginAt === -1) return null;

  // The opening comment may close on its own line or several lines later.
  let openerEndsAt = beginAt;
  while (openerEndsAt < lines.length && !lines[openerEndsAt].includes('-->')) openerEndsAt++;
  if (openerEndsAt === lines.length) return null;

  const endAt = lines.findIndex(
    (line, i) => i > openerEndsAt && line.includes(GENERATED_END)
  );
  if (endAt === -1) return null;

  return normalise(lines.slice(openerEndsAt + 1, endAt).join('\n'));
}

/**
 * Whether a document's generated block still matches what `guidanceTable`
 * produces — the check the corpus workflow runs on **every** pull request.
 *
 * It lives here, and not in the workflow's YAML, for the reason `corpus.ts`
 * gives about the path rules: `pnpm test` covers this and a workflow's YAML is
 * never covered by anything. The wording matters more here than anywhere else
 * in the tool, because the usual cause of a failure is the recommended DPT or
 * the scale table moving in `data.json` — a file the contributor reading the
 * message never touched.
 */
export function checkGuidance(
  markdown: string,
  widthPx: number = REFERENCE_WIDTH_PX
): { ok: boolean; message: string } {
  const expected = normalise(guidanceTable(widthPx));
  const found = extractGeneratedBlock(markdown);

  if (found === null) {
    return {
      ok: false,
      message:
        `The generated capture-guidance block is missing or malformed: no "${GENERATED_BEGIN}" ` +
        `comment, no closing "${GENERATED_END}", or the two in the wrong order. The block is ` +
        `derived from the recommended DPT and must not be deleted — restore the markers ` +
        `and put this between them:\n\n${expected}\n`,
    };
  }

  if (found === expected) {
    return { ok: true, message: 'The capture-guidance table is up to date.' };
  }

  return {
    ok: false,
    message:
      `The capture-guidance table is out of date.\n\n` +
      `**This is almost certainly not about your submission.** The table is derived from ` +
      `recommended_dpt and the scale table in packages/r49/src/data.json, so a change there ` +
      `makes the next pull request red no matter what it touched. The fix is one command, ` +
      `and a maintainer can do it if you would rather not.\n\n` +
      `At the root of this repository, run:\n\n` +
      `    ${GUIDANCE_COMMAND}\n\n` +
      `and paste its output between the generated-block markers in CONTRIBUTING.md.\n\n` +
      `Expected:\n\n${expected}\n\nFound:\n\n${found}\n`,
  };
}
