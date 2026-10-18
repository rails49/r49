# The `.r49` format

This document defines the `.r49` layout archive. With it you can write a reader
for archives in any language. Read the Python and TypeScript packages in this
repository only to check your reader against them, not to learn what an archive
means.

It holds two kinds of requirement, kept apart on purpose:

* **Format rules** say what an archive is. Every reader and writer applies them,
  inside the corpus and outside it. Breaking one makes a file not an archive.
* **Corpus rules** say what this repository accepts. They sit beside the format
  because a reader needs some of them (the vocabulary above all) to interpret a
  field. An archive that breaks a corpus rule is still a valid archive.

A third kind, **reader requirements**, is not defined here at all; see
[Reader requirements](#reader-requirements).

This document and the archives are [CC BY 4.0](LICENSE). The code is
[MIT](LICENSE-MIT).

## Versions

The **format version** is the manifest's `version` field. It is **4**, and this
document defines version 4 only.

The packages (`@rails49/r49` on npm, `rails49-r49` on PyPI) have their own
semver version. A package release that changes no rule leaves the format at 4.
A package release can add an optional field without changing the format version
([ADR 0001](docs/adr/0001-v4-only-and-optional-fields-add-no-version.md)):

* The version changes only when an old file would be misread, or a new file
  would lose data, under the old rules.
* An added optional field does neither. An old archive loads unchanged. A newer
  archive carrying the field is **refused** by an older reader, because unknown
  keys are rejected. It is not misread.

So an older package that refuses an archive with `format/unknown-key` is usually
meeting an archive from a newer release. The packages say so in the error
message.

## The archive

An archive is a zip file. Its root holds:

* `manifest.json`: the manifest, UTF-8 JSON.
* The images, JPEG in practice, at the paths the manifest names in
  `images[].filename`.

The zip holds nothing else. That every image named is present, and every image
present is named, is a [corpus rule](#corpus-rules). A reader that only parses
the manifest does not check it.

## The manifest

```jsonc
{
  "version": 4,
  "id": "0PKAbvK57FA",                                     // optional
  "layout": {
    "name": "…", "description": "…", "contact": "…",      // all optional
    "scale": "HO",
    "calibration": {                                      // optional, defaults to { "points": [] }
      "points": [                                         // optional, defaults to []
        { "px": { "x": 0, "y": 0 }, "world": { "x": 0, "y": 0, "z": 0 } }
      ],
      "camera_height_mm": 1150,                           // optional
      "reference_height_mm": 85                           // optional, reads as 0
    },
    "sensors": [ { "id": "…", "x": 0, "y": 0, "name": "…" } ]   // optional, defaults to []; name optional
  },
  "camera": { "resolution": { "width": 1920, "height": 1080 }, "model": "…" },  // model optional
  "images": [                                             // optional, defaults to []
    {
      "filename": "frame.jpg",
      "labeled_complete": false,                          // optional, defaults to false
      "labels": [                                         // optional, defaults to []
        { "id": "…", "class": "stock",
          "p0": { "x": 0, "y": 0 }, "p1": { "x": 0, "y": 0 },
          "provenance": "human" },
        { "id": "…", "class": "stock.loco.steam",
          "p0": { "x": 0, "y": 0 }, "p1": { "x": 0, "y": 0 },
          "provenance": "corrected", "proposed_by": "v1.0.0" }
      ]
    }
  ]
}
```

A *number* is any finite JSON number. An *integer* is a number with no
fractional part. A *string* may be empty unless stated otherwise.

### Root

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | the integer `4` | The format version. |
| `id` | non-empty string, optional | The archive's identity, stable across every save. It is identity, not an address: renaming or moving the file does not make it a different archive. |
| `layout` | object | The layout the camera sees. |
| `camera` | object | The camera the images were taken with. |
| `images` | array of image | The images, in order. |

The format requires only that an `id` is a non-empty string. The TypeScript
writer mints an 11-character time-ordered id when an archive has none and never
replaces one that exists, but that is how it writes ids, not a format rule.

### `layout`

| Field | Type | Meaning |
| --- | --- | --- |
| `name`, `description`, `contact` | string, optional | Free text. |
| `scale` | one of the scale names in [Scales and gauge](#scales-and-gauge) | The modelling scale. Required, with no default: every DPT depends on it. |
| `calibration` | object | The reference points that fix DPT. |
| `sensors` | array of sensor | Points where occupancy must be reported. Per layout, not per image. |

### `layout.calibration`

| Field | Type | Meaning |
| --- | --- | --- |
| `points` | array of reference point | Each point is `px`, an image position in pixels (`x`, `y` numbers), and `world`, the same feature's position on the layout in mm (`x`, `y`, `z` numbers) from an arbitrary origin fixed for the layout. `z` is height above layout zero. |
| `camera_height_mm` | number > 0, optional | The camera's height above layout zero, in mm. |
| `reference_height_mm` | number, optional | The railhead's height above layout zero, in mm: the plane DPT is reported on. Absent reads as 0. |

An empty `points` is a valid, uncalibrated archive. Neither height has a
default that a reader may write back: a reader that saves an archive which
lacked one must save it without one.

### Sensor

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | non-empty string | Unique among the layout's sensors. |
| `x`, `y` | number | Image position in pixels. |
| `name` | string, optional | Free text, not unique. |

### `camera`

| Field | Type | Meaning |
| --- | --- | --- |
| `resolution` | object of `width`, `height`, integers | The frame the image coordinates are in. |
| `model` | string, optional | Free text. |

### Image

| Field | Type | Meaning |
| --- | --- | --- |
| `filename` | string | The image's path in the zip. |
| `labeled_complete` | boolean | A person's assertion that no car in this image is unlabeled. An image marked complete with no labels is an all-background sample. |
| `labels` | array of car label | The cars in this image. |

### Car label

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | non-empty string | Unique among this image's labels. Label ids and sensor ids are separate namespaces and are never compared. |
| `class` | string | A dotted class name, such as `stock.loco.steam`. Any string is valid at the format level; the [vocabulary](#the-vocabulary) is a corpus rule. |
| `p0`, `p1` | point (`x`, `y` numbers) | The car's span: its two ends along its centerline, in image pixels. Car width is not stored. |
| `provenance` | `"human"`, `"proposed"` or `"corrected"` | How the label came to exist: drawn by a person, a model's proposal accepted as is, or a model's proposal then edited. |
| `proposed_by` | non-empty string | The proposing model's version. Required on `proposed` and `corrected`; forbidden on `human`. |

## Strictness

* **Unknown keys are rejected, not ignored**, in every object. A reader that
  dropped them would save a newer archive shorter than it arrived.
* The only defaults are the ones marked above. They are what a reader sees when
  the key is absent, and nothing more.
* `provenance` has no default: a missing provenance would otherwise pass model
  output off as a person's.

## Format rule ids

A reader that refuses an archive names the rule it broke with one of these ids.
The ids are the contract; the wording of the message is not. When a manifest
breaks more than one rule, which one is reported is not specified. Each
conformance case breaks exactly one.

| Rule id | The archive is refused because |
| --- | --- |
| `format/zip` | the bytes are empty or are not a readable zip. |
| `format/manifest-missing` | the zip has no `manifest.json`. |
| `format/manifest-json` | `manifest.json` is not UTF-8 JSON, or is not a JSON object. |
| `format/version` | `version` is not 4. Checked before any other field. |
| `format/unknown-key` | an object carries a key this document does not define. |
| `format/duplicate-id` | two sensors, or two labels in one image, share an `id`. |
| `format/provenance` | a label's `provenance` is missing or not one of the three, or `proposed_by` is present on `human`, or absent or empty on `proposed` or `corrected`. |
| `format/field` | any other field is missing, of the wrong type, or out of range. Examples: no `scale`, an unknown scale name, an empty `id`, `camera_height_mm` ≤ 0. |

## Scales and gauge

The prototype's standard gauge is **1435 mm**. A model's track gauge in mm is
the standard gauge divided by the scale's ratio:

| Scale | Ratio |
| --- | --- |
| G | 1:25 |
| O | 1:48 |
| S | 1:64 |
| HO | 1:87 |
| T | 1:120 |
| N | 1:160 |
| Z | 1:220 |

These values are authored once, in [`data/r49.json`](data/r49.json), which both
packages ship. If this table and that file disagree, the file is right.

## The calibration fit

DPT (dots per track) is image pixels per track gauge, measured on the reference
plane. It comes from one least-squares fit over pairs of reference points. Both
packages return the whole fit as one result. An outside reader computing it
must match every part of it.

Let `h` be `camera_height_mm` (possibly absent), `z_ref` be
`reference_height_mm` (0 when absent), and `gauge` be the model's track gauge in
mm.

**Which points are left out.** Each point is checked in this order, and the
first reason that applies is the one reported:

1. `off-reference-plane`: `h` is absent and the point's `z ≠ z_ref`. Without a
   camera height the fit can only speak about the plane named.
2. `above-camera`: `h` is present and the point's `z ≥ h`.
3. `no-partner`: no other point that passed 1 and 2 has the same `z`.

`z` values compare exactly; they are typed by hand.

**The pairs.** Every unordered pair `(i, j)`, `i < j`, of points that were not
left out and share the same `z`. For each pair:

```
d_px = |px_i − px_j|                     (Euclidean, image pixels)
d_mm = |(world_i − world_j) in x, y|     (Euclidean, mm; z is equal)
d_px' = d_px · (h − z) / h               when h is present, else d_px
```

**The scale and DPT.**

```
s   = Σ(d_px' · d_mm) / Σ(d_mm²)         over the pairs
DPT = s · gauge · h / (h − z_ref)        when h is present
DPT = s · gauge                          when h is absent
```

DPT is `null` (does not resolve) when `Σ(d_mm²) = 0`, which covers no pairs
and coincident points, or when `h` is present and `h ≤ z_ref`.

**The residual**, in image pixels:

```
residual = sqrt( Σ(d_px' − s · d_mm)² / n )   over the n pairs
```

The residual is `null` when there are fewer than two pairs, or `Σ(d_mm²) = 0`.
It does not depend on DPT resolving. It is a cross-check, not a rule: a large
residual means a reference point is mistyped or the camera height is wrong.

**Camera height fits** is `null` when `h` is absent. Otherwise it is true when
`h` is above `z_ref` and above every reference point's `z`, and false if not.
A false value is not a format error. The editor refuses to save one; a reader
may treat the archive's DPT as untrustworthy.

The reasoning, including why focal length is not used, is in
[ADR 0002](docs/adr/0002-camera-height-corrects-scale.md).

## Corpus rules

These apply to archives submitted to this repository. Each is checked by the
corpus validator, which reports it under the id shown. A **blocking** rule
refuses the submission; a **warning** is reported and never refuses.

Blocking, for archives under `archives/`:

| Id | Rule |
| --- | --- |
| `archive/load` | The archive is valid under every format rule. The format rule id is part of the message. |
| `images/missing` | Every `images[].filename` is present in the zip. |
| `images/orphan` | Every file in the zip other than `manifest.json` is named by an image. |
| `archive/id` | The archive has an `id`. |
| `archive/id-collision` | No two archives in one contributor directory share an `id`. |
| `labels/provenance` | No label is `proposed`. A proposal must be reviewed, which makes it `corrected`. |
| `labels/class` | Every label's `class` is in the [vocabulary](#the-vocabulary). |
| `path/shape` | The file is at `archives/<handle>/<slug>.r49` (or `fixtures/<slug>.r49`). |
| `path/slug` | The file name is lowercase letters, digits and hyphens, then `.r49`. |
| `path/owner` | `<handle>` is the pull request author's GitHub handle. |

Archives under `fixtures/` are held to `archive/load`, `images/missing`,
`images/orphan` and the two path-shape rules only, and get no warnings.

Warnings:

| Id | Warns when |
| --- | --- |
| `calibration/unresolved` | DPT does not resolve. |
| `calibration/dpt` | DPT is below the recommended DPT. |
| `calibration/off-reference-plane` | Some points are left out as `off-reference-plane`. |
| `images/incomplete` | Some images are not `labeled_complete`. |

### The recommended DPT

The **recommended DPT** is the DPT the corpus asks contributors to reach. It is
`recommended_dpt` in [`data/r49.json`](data/r49.json), currently **20**. It is
this repository's number and a warning only; it does not depend on any reader's
minimum DPT. The capture table in [CONTRIBUTING.md](CONTRIBUTING.md) is derived
from it.

### The vocabulary

The vocabulary is the tree of classes an author may assign, authored as
`vocabulary` in [`data/r49.json`](data/r49.json):

```
stock
├── loco
│   ├── steam
│   ├── diesel
│   └── electric
├── passenger
└── freight
```

Reading the tree:

* **A nested object is a subtype; any other value is a property** of the class
  it sits under. There are no reserved key names. (Today no class carries a
  property.)
* A `class` names a node by its path of segments from the root, joined by `.`:
  `stock`, `stock.loco`, `stock.loco.steam`. The root `stock` is part of every
  class; an unrooted `loco.steam` is not in the vocabulary.
* Matching is **segment by segment**. `stock` is a prefix of `stock.loco` and of
  `stock` itself, never of `stockyard`. Both packages expose this
  segment-prefix rule, so a reader mapping classes onto its own labels can
  apply the same one.

Plain `stock` is always a correct class. A subtype is a refinement, not a
requirement.

## Reader requirements

Some conditions belong to one reader, not to the format or the corpus. This
document does not set them, and you should set your own:

* **Minimum DPT.** The DPT below which images are too coarse for *your* model.
  The recommended DPT is a capture target, not anyone's minimum. Filter on the
  fit's DPT and residual as your model needs.
* **Car width.** The format stores a car's span, not its width. How wide a box
  to draw around a span is a modelling choice; the occupancy detector chooses a
  wide one on purpose.
* **`labeled_complete` filtering.** Whether to train on incomplete images is
  yours to decide. A complete image's unlabeled areas are verified background;
  an incomplete image's are not.

## Conformance cases

[`conformance/`](conformance/) holds one directory per case. Each holds either
`archive.r49` or a bare `manifest.json`, plus `expected.json`:

```jsonc
{
  "accept": true,              // or false
  "rule": "format/version",    // when accept is false: the rule id
  "fit": {                     // when present: the calibration fit
    "dpt": 16.5885,            // or null
    "residual": 5.3452,        // or null
    "pairs": [[0, 1], [0, 2], [1, 2]],
    "left_out": [{ "point": 3, "reason": "off-reference-plane" }],
    "camera_height_fits": null,
    "tolerance": 1e-9          // absolute, for dpt and residual
  },
  "id": "0PKAbvK57FA"          // when present: the archive id
}
```

A bare `manifest.json` is checked as a manifest only. Its bytes are not
wrapped in a zip. Both packages run every case. Your reader conforms when it
accepts and refuses the same cases with the same rule ids and computes the same
fit.

`conformance/format-v4/archive.r49` was written once and is never regenerated;
see its README.
