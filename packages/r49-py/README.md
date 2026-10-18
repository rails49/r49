# rails49-r49

Reads `.r49` railroad layout archives in Python: a zip holding a `manifest.json`
plus the layout photographs it describes. The format is defined in
[FORMAT.md](../../FORMAT.md); this package is a reader of it, and agrees with
the TypeScript package [`@rails49/r49`](../r49/) on every
[conformance case](../../conformance/).

Read-only: it loads, validates and fits archives, and never writes one.

## Interface

See [`src/r49/__init__.py`](src/r49/__init__.py), the package's public surface.
Anything not exported there is internal and may change without notice.

The scale table and the vocabulary are read from the TypeScript package's
[`data.json`](../r49/src/data.json), linked into the package as
`src/r49/data.json`; no value of them is declared in code. The sdist holds a
copy of the file in place of the link.

## Example

```python
import r49

archive = r49.load("layout.r49")          # a path, or the archive's bytes
manifest = archive.manifest
print(manifest.layout.name, manifest.layout.scale)

result = r49.fit(manifest)
print(result.dpt, result.residual)        # None where the fit cannot answer
for left_out in result.left_out:
    print(left_out.index, left_out.reason)

jpeg = archive.image(manifest.images[0].filename)
for mismatch in archive.image_mismatches():   # empty when the images match
    print(mismatch.rule, mismatch.filename)

r49.is_known_class("stock.loco.steam")    # True
```

A refusal is an `r49.R49Error` whose `rule` is the format rule id broken, such
as `manifest/unknown-key`. The id is the contract; the message is not. An
archive whose images and manifest disagree still loads; `image_mismatches()`
lists each disagreement under `images/missing` or `images/orphan`.
`r49.parse_manifest` reads a bare `manifest.json`, which is exempt from the zip
and image rules.

A car label's `class` is `class_` in Python; the manifest key stays `class`.

## Build and test

Managed with [uv](https://docs.astral.sh/uv/):

```sh
uv sync --locked
uv run pytest            # the conformance cases and the reader's own tests
uv run ruff check .
uv run black --check .
uv run pyright
uv build                 # the sdist, then the wheel from it
```

Nothing is published yet.

## Licence

[MIT](../../LICENSE-MIT).
