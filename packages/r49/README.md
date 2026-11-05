# @rails49/r49

Reads and writes `.r49` railroad layout archives — a zip or a folder holding a
`manifest.json` plus the layout photographs it describes. A zip is held whole in
memory; a folder is read one file at a time, through its base URL. The format is defined
in [FORMAT.md](https://github.com/rails49/r49/blob/main/FORMAT.md); this package is
one implementation of it, and the
[conformance cases](https://github.com/rails49/r49/tree/main/conformance) are how
it, or any other, shows it agrees.

Manifests are validated against v4 on load, so a successfully loaded archive is
a well-formed one. A refusal is an `R49Error` whose `rule` names the format rule
broken. An archive whose images and manifest disagree still loads;
`imageMismatches()` reports each disagreement under `images/missing` or
`images/orphan`. Works unchanged in Node and the browser.

## Interface

See [`src/index.ts`](https://github.com/rails49/r49/blob/main/packages/r49/src/index.ts)
— that file is the package's public surface.
Anything not exported there is internal and may change without notice. Per-
symbol documentation lives on the declarations in `src/archive.ts` and
`src/manifest.schema.ts`, where your editor will show it on hover.

The scale table and the vocabulary are in
[`src/data.json`](https://github.com/rails49/r49/blob/main/packages/r49/src/data.json),
so a reader in another language can load the same numbers. It also holds the
corpus's recommended DPT, which the validator in `tools/r49-validate/` reads.
The file is exported as `@rails49/r49/data.json` and is public interface: a
change to its shape follows semver, as a change to `src/index.ts` does.

## Build and test

```sh
pnpm install --frozen-lockfile
pnpm --filter @rails49/r49 build   # dist/, JS with .d.ts
pnpm --filter @rails49/r49 test    # the TypeScript tests and the conformance cases
```

Installed with `npm install @rails49/r49`.

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

### A base URL

```typescript
const archive = await R49Archive.load('https://example.org/archives/layout.r49/');
const jpeg = await archive.getImage(archive.getManifest().images[0].filename);

await archive.addImage('new-shot.jpg', bytes);
await archive.writeChanges({
  put: async (name, bytes) => { /* PUT to <base>/<name> */ },
  remove: async name => { /* DELETE <base>/<name> */ },
});
```

A base URL is read as `<base>/manifest.json` and `<base>/<filename>`, with each
path segment percent-encoded. It ignores a path with a segment that starts with a
dot, as a folder does: `getImage` returns null and makes no request, and
`addImage` throws `images/missing`. A 404 means the file is absent. Any other HTTP
or network failure throws something other than an `R49Error`, because it is no
verdict on the archive. A URL cannot be listed, so `listEntries()` is
`manifest.json` and the names in the manifest, and `imageMismatches()` is empty.
`export()` fetches each image it does not hold, and throws if one is missing.

`writeChanges` writes the added images, then the manifest, then the removals, and
holds no image it has written. The next call after a rejected `put` or `remove`
writes what is still unwritten. It throws on a zip, which `export()` writes.

## Licence

[MIT](https://github.com/rails49/r49/blob/main/LICENSE-MIT). It moved here from
[rails49/occupancy](https://github.com/rails49/occupancy), where it was
`@occupancy/r49`.
