# @rails49/r49

Reads and writes `.r49` railroad layout archives — a zip holding a
`manifest.json` plus the layout photographs it describes. The format is defined
in [FORMAT.md](../../FORMAT.md); this package is one implementation of it, and
the [conformance cases](../../conformance/) are how it, or any other, shows it
agrees.

Manifests are validated against v4 on load, so a successfully loaded archive is
a well-formed one. Works unchanged in Node and the browser.

## Interface

See [`src/index.ts`](src/index.ts) — that file is the package's public surface.
Anything not exported there is internal and may change without notice. Per-
symbol documentation lives on the declarations in `src/archive.ts` and
`src/manifest.schema.ts`, where your editor will show it on hover.

The scale table and the vocabulary are in [`src/data.json`](src/data.json), so
a reader in another language can load the same numbers. It also holds the
corpus's recommended DPT, which the validator in `tools/r49-validate/` reads.
The file is exported as `@rails49/r49/data.json`.

## Build and test

```sh
pnpm install --frozen-lockfile
pnpm --filter @rails49/r49 build   # dist/, JS with .d.ts
pnpm --filter @rails49/r49 test    # the TypeScript tests and the conformance cases
```

Nothing is published yet.

## Example

```typescript
import { R49Archive, getDPT } from '@rails49/r49';
import fs from 'node:fs';

// Load and inspect
const archive = await R49Archive.load(fs.readFileSync('layout.r49'));
const manifest = archive.getManifest();
console.log(`Layout: ${manifest.layout.name}, scale ${manifest.layout.scale}`);

// Resolution in dots-per-track, or null if the layout is uncalibrated
const dpt = getDPT(manifest);

// Modify, then write back
manifest.layout.description = 'Updated layout description';
archive.setManifest(manifest);
await archive.addImage('new-shot.jpg', fs.readFileSync('new-shot.jpg'));

fs.writeFileSync('layout.r49', await archive.export());
```

The manifest returned by `getManifest()` is live — mutating it changes what
`export()` writes. `setManifest()` re-validates, so use it when replacing the
manifest wholesale.

Only v4 is supported. Earlier archives are not readable.

## Licence

[MIT](../../LICENSE-MIT). It moved here from
[rails49/occupancy](https://github.com/rails49/occupancy), where it was
`@occupancy/r49`.
