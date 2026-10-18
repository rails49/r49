# rails49-r49

Read and validate `.r49` model railroad layout archives, and compute their
calibration fit. Read-only: this package does not write archives.

The format is defined in [FORMAT.md](https://github.com/rails49/r49/blob/main/FORMAT.md).
The archives themselves are the [rails49/r49](https://github.com/rails49/r49)
corpus, under CC BY 4.0; installing this package does not download them.

```sh
pip install rails49-r49
```

```python
import r49

archive = r49.load("archives/someone/yard.r49")   # a path or the bytes
manifest = archive.manifest                       # validated, read-only
jpeg = archive.image(manifest.images[0].filename)

fit = r49.calibration_fit(manifest)
fit.dpt                  # dots per track, or None when calibration does not resolve
fit.residual             # pixels, or None below two pairs
fit.pairs                # the reference point pairs the fit used
fit.left_out             # the points it did not use, and why
fit.camera_height_fits   # None without a camera height

r49.is_known_class("stock.loco.steam")   # True
r49.SCALE_TO_RATIO["HO"], r49.STANDARD_GAUGE, r49.RECOMMENDED_DPT
```

An archive that breaks a format rule raises `r49.FormatError`. Its `rule` is
the rule id from FORMAT.md, such as `format/unknown-key`; match on that, not on
the message. An unknown key usually means the archive was written by a newer
release: upgrade the package.

`r49.MANIFEST_VERSION` is the format version (4). `r49.__version__` is the
package version; the two move independently.

Minimum DPT, car width and whether to use images that are not
`labeled_complete` are yours to choose. See FORMAT.md § Reader requirements.

MIT licensed.

## Development

The package is a member of the repository's uv workspace (`../pyproject.toml`,
locked in `../uv.lock`). From the repository root:

```sh
uv run --package rails49-r49 pytest python
(cd python && uv run ruff check . && uv run black --check . && uv run pyright)
```
