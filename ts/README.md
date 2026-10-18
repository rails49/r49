# @rails49/r49

Reads, writes and validates `.r49` model railroad layout archives: a zip
holding a `manifest.json` plus the layout photographs it describes. It is the
implementation the [rails49 editor](https://occupancy.rails49.org) uses, and it
works unchanged in Node and the browser.

The format is defined in [FORMAT.md](https://github.com/rails49/r49/blob/main/FORMAT.md).
This package implements it; where the two disagree, FORMAT.md is right and this
is a bug.

```sh
npm install @rails49/r49
```

## Interface

See [`src/index.ts`](src/index.ts): that file is the package's public surface.
Anything not exported there is internal and may change without notice.
Per-symbol documentation lives on the declarations, where your editor shows it
on hover.

## Example

```typescript
import { R49Archive, FormatError, calibrationFit, isKnownClass } from '@rails49/r49';
import fs from 'node:fs';

let archive: R49Archive;
try {
  archive = await R49Archive.load(fs.readFileSync('layout.r49'));
} catch (err) {
  // err.rule is a FORMAT.md rule id, such as 'format/unknown-key'.
  if (err instanceof FormatError) console.error(err.rule);
  throw err;
}

const manifest = archive.getManifest();
const fit = calibrationFit(manifest);
fit.dpt;              // dots per track, or null when calibration does not resolve
fit.residual;         // pixels, or null below two pairs
fit.leftOut;          // reference points the fit did not use, and why
isKnownClass('stock.loco.steam');   // true

// Modify, then write back
manifest.layout.description = 'Updated layout description';
archive.setManifest(manifest);
await archive.addImage('new-shot.jpg', fs.readFileSync('new-shot.jpg'));
fs.writeFileSync('layout.r49', await archive.export());
```

The manifest returned by `getManifest()` is live: mutating it changes what
`export()` writes. `setManifest()` re-validates, so use it when replacing the
manifest wholesale. `export()` mints an archive `id` when there is none and
never replaces one that exists.

## Versions

`MANIFEST_VERSION` is the format version, 4. The package's own semver version
is separate: a release can add an optional field without changing the format
version, and an older release refuses an archive carrying a field it does not
know, with `format/unknown-key`.

## Development

```sh
pnpm install
pnpm test        # includes every case under ../conformance
pnpm typecheck
pnpm build       # dist/, with .d.ts and r49.json
```

`src/r49.json` is a symlink to the repository's `data/r49.json`, the one
authored copy; the build writes the file itself into `dist/`.

MIT licensed.
