# Conformance cases

Inputs with the outcome [FORMAT.md](../FORMAT.md) gives them. An implementation
of the format in any language runs every case here and agrees with each one.
The TypeScript runner is [`packages/r49/tests/conformance.ts`](../packages/r49/tests/conformance.ts),
run by `pnpm test`; the Python one is
[`packages/r49-py/tests/test_conformance.py`](../packages/r49-py/tests/test_conformance.py),
run by `uv run pytest` there.

## A case

Each directory under `cases/` is one case. It holds exactly one input:

* `archive.r49`: archive bytes, to be loaded as an archive. They are not always
  a zip; some cases exist to be refused as `archive/empty` or `archive/not-zip`.
  It may instead be a folder, an archive in that form: see
  [The forms of an archive](#the-forms-of-an-archive).
* `manifest.json`: a bare manifest, to be parsed on its own. FORMAT.md exempts
  a bare manifest from `archive/empty`, `archive/not-zip`, `archive/no-manifest`,
  `images/missing` and `images/orphan`. A runner whose implementation reads manifests only inside an
  archive may zip the bytes as `manifest.json` beside a placeholder for every
  image the manifest names, which is what the TypeScript runner does.
* `track.json`: tracks, `{ "tracks": [...] }`, each a track as
  [FORMAT.md § Track](../FORMAT.md#track) gives it. The case is about the curve
  between nodes, [FORMAT.md § Node](../FORMAT.md#node), not about accepting or
  refusing: see [A track case](#a-track-case).

and `expected.json`, which for an archive or a manifest is:

```jsonc
{
  "description": "…",            // what the case is about; not checked
  "result": "accept",            // or "reject"
  "rule": "manifest/schema",     // reject only: the format rule id
  "dpt": 164.9425287356322,      // accept only: DPT, or null where it does not resolve
  "residual": null,              // accept only: the residual, or null
  "tolerance": 1e-9,             // absolute; applies to dpt and residual when either is a number
  "image_mismatches": [          // accept only: what the archive reports; absent means none
    { "rule": "images/orphan", "filename": "notes.txt" }
  ]
}
```

A case **agrees** when:

* the outcome is `result`;
* on reject, the rule id reported is `rule`;
* on accept, each of `dpt` and `residual` that is present is `null` when the
  implementation's is null, and otherwise within `tolerance` of it. Absent
  means not checked;
* on accept, the image mismatches the implementation reports are
  `image_mismatches`, in any order, or none when it is absent.

Cases assert rule ids, never message text: the id is the contract, the wording
is not. Every format rule id has at least one case: a rejecting case, or for
`images/missing` and `images/orphan`, which are reported and never refused, an
accepting case that reports it. Each rejecting case breaks exactly one rule,
since FORMAT.md does not say which rule is reported when several are broken.

### The forms of an archive

A runner runs an `archive.r49` case in each form its implementation reads, and
every form agrees:

* A zip, or a folder, as the case holds it.
* A readable zip unpacked as a folder. So a zip case holds no dot path, which a
  zip reports and a folder ignores.
* Over a local HTTP server, from a base URL: a readable zip unpacked, or a
  folder. FORMAT.md exempts a URL from `images/missing` and `images/orphan`, so
  over a URL `image_mismatches` is not checked.

A zip that is not readable, one a case expects refused as `archive/empty` or
`archive/not-zip`, runs as a zip only. A folder case does not run as a zip: a dot
path it holds would be an orphan there.

The TypeScript runner runs each readable zip as a zip and over a URL, and each
folder over a URL, as `@rails49/r49` reads a folder only through its base URL.
The Python runner runs every form.

### A track case

Its `expected.json`:

```jsonc
{
  "description": "…",            // what the case is about; not checked
  "points": [                    // points on the curve
    { "track": 0, "segment": 0, "t": 0.5, "x": 150, "y": 200, "heading": 0.9272952180016122 }
  ],
  "nearest": [                   // the point on the tracks nearest `at`
    { "at": { "x": 333, "y": 140 }, "track": 0, "x": 333, "y": 100, "heading": 0, "distance": 40 }
  ],
  "tolerance": 1e-9              // absolute; applies to every number checked
}
```

`segment` is the index of the segment's first node in the track's `nodes`. A
track case **agrees** when:

* for each of `points`, the point on that segment at `t` is within `tolerance`
  of `x` and `y`, and the heading there is in (−π, π] and within `tolerance`
  of `heading`, modulo 2π;
* for each of `nearest`, the nearest point is on track `track`, its position
  and its distance from `at` are within `tolerance` of `x`, `y` and
  `distance`, and its heading is as for `points`.

Every expected value in a track case comes from a closed form, worked in the
case's `description`, never from an implementation's output.

## The cases

The names say what each is about: `accept-*`; `reject-*`, named after the rule
broken; `images-*` for an archive that loads and reports an image mismatch, with
`-folder` in the name where its `archive.r49` is a folder;
`fit-*` for the calibration fit; `height-*` for the fit with a camera
height; and the track cases, `curve-*` for points on the curve between nodes
and `nearest-*` for the nearest point on a track.
`accept-written-by-typescript` is an archive `@rails49/r49`'s writer exported,
with that package's DPT and residual.
`format-v4` is the frozen archive rails49/occupancy wrote in August 2026; it is
never regenerated, and its [README](cases/format-v4/README.md) says why.

The DPT and residual in the `fit-*` and `height-*` cases were computed from
FORMAT.md § The calibration fit by an implementation separate from this
repository's package, and agree with it.

## Adding a case

Add a directory with an input and `expected.json`, and say in `description`
what the case shows. A new format rule needs a rejecting case before it is
done. Never change an existing case's input or expectation to make an
implementation pass: a case that changes changes the format.

## Licence

The cases are [CC BY 4.0](../LICENSE), like the format they test.
