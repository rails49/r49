# r49-validate

The corpus validator: what CI asserts about an archive submitted to this
repository. It is not published; run it from a checkout. The rules it applies
are [FORMAT.md § Corpus rules](../../FORMAT.md#corpus-rules), and it is built on
the `r49` Python package in [`../../python`](../../python), so it reads archives
exactly as an outside reader does.

It moved here from `rails49/occupancy`'s `tools/r49-validate`, where it was
TypeScript. Its blocking set, warnings, report shape and exit codes are
unchanged, except that the DPT warning now compares against this repository's
recommended DPT (`recommended_dpt` in `data/r49.json`), not the detector's
minimum.

## Check your archive before you open a pull request

From the repository root, with [uv](https://docs.astral.sh/uv/) installed:

```sh
uv run --package r49-validate r49-validate archives/<your-handle>/<slug>.r49
```

Add `--author <your-handle>` to apply the directory-ownership rule too; CI
passes the pull request author's handle.

## Use

```sh
r49-validate <path>...                      # validate .r49 files
r49-validate guidance                       # print the capture-guidance table
r49-validate guidance --check CONTRIBUTING.md
```

**stdout is machine, stderr is human, always both.** The workflow pipes stdout
(a JSON report, `version: 1`) through `jq` for its annotations and job summary;
a person reads stderr.

| Exit | Meaning |
| :--- | :--- |
| `0` | No blocking errors. Warnings do not change this. |
| `1` | At least one archive carries a blocking error, or the guidance table is stale. |
| `2` | The tool itself failed: bad arguments, an unreadable path, a bug. |

`fixtures/<slug>.r49` is held to structure only and gets no warnings.

## The guidance table is generated, never typed

The capture table in `CONTRIBUTING.md` is derived from `recommended_dpt` and the
scale table in `data/r49.json`. CI diffs the committed block against
`r49-validate guidance`, so changing the data file means regenerating it:

```sh
uv run --quiet --package r49-validate r49-validate guidance
```

## Development

```sh
uv run --package r49-validate pytest tools/r49-validate
```
