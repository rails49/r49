# `@rails49/r49-validate`

The corpus validator: what CI checks on every submitted `.r49`. Built on
[`@rails49/r49`](../../packages/r49/) in this workspace, unpublished, MIT. It
came here from rails49/occupancy, where it was `@occupancy/r49-validate`; issue
numbers in its comments are occupancy's unless they say otherwise.

The recommended DPT and the scale table come from the package's
[`data.json`](../../packages/r49/src/data.json), read as
`@rails49/r49/data.json`, so no number here has a second home.

## Use

Build first, from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter "@rails49/r49-validate..." build
```

```bash
# Print the capture-guidance table for CONTRIBUTING.md. Takes no paths, so it
# does not care what the working directory is. --silent is required, not
# cosmetic: without it pnpm writes its script banner to stdout, and CI diffs
# that stdout against committed prose.
pnpm --silent --filter @rails49/r49-validate guidance
```

Validation takes **paths**, and `pnpm --filter` runs a script with the working
directory set to the package, so every relative path would resolve against
`tools/r49-validate/`. Run the CLI from the repository root instead:

```bash
node tools/r49-validate/dist/cli.js --author <handle> <path>...
node tools/r49-validate/dist/cli.js guidance --check CONTRIBUTING.md
```

Only paths under `archives/` and `fixtures/`, the corpus, are judged. Any other
path is skipped with a note on stderr: the cases under `conformance/` break
format rules on purpose and are not submissions.

`guidance --check` verifies instead of printing: it reads a document, pulls the
block out from between its `BEGIN GENERATED` / `END GENERATED` markers, and
compares it to what `guidance` would emit. Exit 1 on drift, 0 when it matches.
The comparison and its failure message live in `guidance.ts` rather than in the
workflow's YAML because `pnpm test` covers this and YAML is covered by nothing.

**stdout is machine, stderr is human — always both, no flag.** The workflow
pipes stdout through `jq` to build its `::warning` annotations and its job
summary; a person reads stderr. One code path serves both, so the rendering
nobody tests cannot drift from the one that matters.

| Exit | Meaning |
| :--- | :--- |
| `0` | No blocking errors. Warnings do not change this — that is what makes the bar soft. |
| `1` | At least one archive carries a blocking error. |
| `2` | The tool itself failed: bad arguments, an unreadable path, a bug. |

`1` and `2` are distinct on purpose. A crash here must never read as "your
archive is bad" to a contributor who did nothing wrong.

`--author` is the pull request author's handle, used only for `path/owner`.
Omitting it skips that one rule, so a contributor can run the tool locally
without inventing a value.

## What it checks

[FORMAT.md § Corpus rules](../../FORMAT.md#corpus-rules) is the list, by rule
id; `validate.ts` implements it and `corpus.ts` holds the path rules. An archive
`R49Archive.load()` refuses is reported under the id of the format rule it
breaks (`archive/not-zip`, `manifest/version`, ...), read off the `R49Error`.
Every archive that loads is then checked for `images/missing` and
`images/orphan`, read off `imageMismatches()`, fixtures included. Under `archives/<handle>/<slug>.r49` the corpus rules then block on
`archive/id`, `archive/id-collision`, `labels/provenance`, `labels/class`,
`path/shape`, `path/slug` and `path/owner`.

Warnings, read by the maintainer and blocking nothing: `calibration/dpt` (DPT
below the recommended DPT, 20), `calibration/unresolved`,
`calibration/off-reference-plane` and `images/incomplete`.

**A missing `camera_height_mm` is deliberately not one of them.** It would fire
on every submission from day one, fixtures included, and a warning that always
fires devalues the ones that mean something ([#139]). The editor is where the
height is *required*; here it is a fact in the table, alongside the reference
height and the obliquity the two of them imply. The narrower warning above is
the one place the fit silently means something other than the contributor
intends: without a height, points off the reference plane are excluded from it.

The geometry facts are **reported, never thresholded** — the `dptResidual`
precedent. The obliquity is quantified but its cost to detection accuracy is
unmeasured, so a bar here would be a number nothing earned ([#136]). It is also
a *lower* bound: the camera is assumed to hang over the centre of the calibrated
extent, and an archive calibrated on one patch of a larger layout under-reports.

[#136]: https://github.com/rails49/occupancy/issues/136
[#139]: https://github.com/rails49/occupancy/issues/139

`fixtures/<slug>.r49` is held to the format rules, `path/shape` and `path/slug`
only, and gets **no warnings**: the six are below the recommended DPT by
design, so annotating that on every pull request would be noise.

## The two readers agree on the corpus

The conformance cases show `@rails49/r49` and the Python reader, `rails49-r49`,
agree on purpose-built inputs. `readers` shows they agree on the archives
contributors sent. [`read.py`](read.py) writes Python's outcome for each archive
as JSON, and `readers` compares it with TypeScript's: accept or reject, the
format rule on reject, DPT and residual within 1e-9, and the image mismatches
on accept. Any difference, or an archive only one side reported, exits 1.

```bash
uv run --project packages/r49-py --locked python tools/r49-validate/read.py \
  fixtures/*.r49 > python.json
node tools/r49-validate/dist/cli.js readers --python python.json fixtures/*.r49
```

## The guidance table is generated, never typed

A per-scale capture table hand-written into `CONTRIBUTING.md` would be the
recommended DPT living in two places with nothing checking that they agree, so
CI diffs the committed prose against `guidance`'s output. That is why the
output has a fixed column order and fixed rounding, and why it states its
reference image width: the width is an input to every number, not a constant.
