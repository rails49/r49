# The `.r49` format

This document defines the `.r49` layout archive, so that you can read one in any
language without reading any program that writes them. The vocabulary it uses is
in [GLOSSARY.md](GLOSSARY.md).

It holds two kinds of rule, kept apart on purpose:

* **[Format rules](#format-rules)** say what an archive is. They hold for every
  archive, inside the corpus and outside it. A file that breaks one is not a
  valid archive. A reader refuses it, except under the two image rules, which a
  reader reports.
* **[Corpus rules](#corpus-rules)** say what this repository accepts. They sit
  here because a reader needs some of them to interpret a field (the vocabulary
  above all), but an archive that breaks one is still a valid archive.

A third kind, [reader requirements](#reader-requirements), this document does
not set at all.

This document is licensed [CC BY 4.0](LICENSE), like the archives it describes.

## The archive

An archive is a zip file. At its root it holds:

* `manifest.json`: the manifest, UTF-8 JSON with no byte-order mark, described below.
* The images, JPEG in practice, each at the path its `images[].filename` names.

Nothing else. Every image the manifest names is in the zip, and every file in
the zip other than `manifest.json` is an image the manifest names.

One archive is one layout seen from one camera position. Calibration and
sensors belong to the layout, not to an image, so every image in an archive
shares them.

## The manifest

```jsonc
{
  "version": 4,
  "id": "0PKAbvK57FA",                                     // optional
  "layout": {
    "name": "…", "description": "…", "contact": "…",      // all optional
    "scale": "HO",
    "calibration": {                                      // optional, reads as { "points": [] }
      "points": [                                         // optional, reads as []
        { "px": { "x": 0, "y": 0 }, "world": { "x": 0, "y": 0, "z": 0 } }
      ],
      "camera_height_mm": 1150,                           // optional
      "reference_height_mm": 85                           // optional, reads as 0
    },
    "sensors": [ { "id": "…", "x": 0, "y": 0, "name": "…" } ]   // optional, reads as []; name optional
  },
  "camera": { "resolution": { "width": 1920, "height": 1080 }, "model": "…" },  // model optional
  "images": [                                             // optional, reads as []
    {
      "filename": "frame-01.jpg",
      "labeled_complete": false,                          // optional, reads as false
      "labels": [                                         // optional, reads as []
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

A *number* is any finite JSON number. An *integer* is a number with no fractional part.
A *string* may be empty unless the table says otherwise. Image positions are in
pixels of the frame `camera.resolution` names, with `x` to the right and `y`
down. Layout positions are in millimetres.

### Root

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `version` | the integer `4` | The format version. See [Versions](#versions). |
| `id` | non-empty string, optional | The archive's identity, the same across every save. It is identity, not an address: renaming or moving the file does not make it a different archive. |
| `layout` | object | The layout the camera sees. |
| `camera` | object | The camera the images were taken with. |
| `images` | array of image | The images, in order. |

The format asks only that an `id` be a non-empty string. How a writer mints one
is the writer's choice, and a writer never replaces an `id` that exists. The
corpus requires one; see [Corpus rules](#corpus-rules).

### `layout`

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `name`, `description`, `contact` | string, optional | Free text. |
| `scale` | a scale name from [Scales and gauge](#scales-and-gauge) | The modelling scale. Required, with no default: DPT depends on it. |
| `calibration` | object | The reference points that fix DPT. |
| `sensors` | array of sensor | Points on the layout where occupancy must be reported. They describe where an answer is wanted, not what is in any image, and are never training data. |

### `layout.calibration`

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `points` | array of reference point | The reference points. Empty means uncalibrated, which is a valid state. |
| `camera_height_mm` | number > 0, optional | The camera height: its distance above layout zero, in mm. |
| `reference_height_mm` | number, optional | The reference height: the railhead's height above layout zero, in mm. DPT is reported on this plane. Absent reads as 0. |

A **reference point** is a feature given twice:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `px` | `{ x, y }`, numbers | Where the feature is in the image, in pixels. |
| `world` | `{ x, y, z }`, numbers | Where it is on the layout, in mm, from an origin and orientation the author chose. The origin is the same for every point in the layout; `z` is the height above layout zero. |

A reference point has no `id` and no name. Nothing refers to a single point.

### Sensor

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id` | non-empty string | Unique among the layout's sensors. |
| `x`, `y` | numbers | The sensor's image position. |
| `name` | string, optional | Free text, not unique. |

### `camera`

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `resolution` | `{ width, height }`, integers | The frame every image position is in. |
| `model` | string, optional | Free text. |

### Image

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `filename` | string | The image's path in the zip. |
| `labeled_complete` | boolean | Labeled complete: a person's assertion that no car in this image is unlabeled. An image marked complete with no labels is a valid all-background sample. Absent reads as `false`; nothing but a person sets it. |
| `labels` | array of car label | The cars in this image. |

The order of `images` is part of the archive, and a writer keeps it.

### Car label

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id` | non-empty string | Unique among this image's labels. Label ids and sensor ids are separate namespaces and are never compared. |
| `class` | string | The car's class: a dotted name such as `stock.loco.steam`. Any string is valid in the format; the [vocabulary](#the-vocabulary) is a corpus rule. |
| `p0`, `p1` | `{ x, y }`, numbers | The span: the car's two ends along its centerline, in image pixels. The car's width is not stored. |
| `provenance` | `"human"`, `"proposed"` or `"corrected"` | How the label came to exist: drawn by a person, a model's proposal accepted as is, or a model's proposal a person then edited. |
| `proposed_by` | non-empty string | The proposing model's version, in any form. Required when `provenance` is `proposed` or `corrected`; forbidden when it is `human`. |

`provenance` has no default. A missing one would otherwise pass model output off
as a person's work. No record of the original proposal is kept on a `corrected`
label.

A train is not stored. Cars whose ends coincide exactly form one, and the
coupling between them is the shared end point.

## Strictness

* **Unknown keys are refused**, in every object, not ignored. A reader that
  dropped them would save a newer archive shorter than it arrived, deleting
  what a newer writer wrote.
* The only defaults are the ones marked *reads as* above. They are what a reader
  sees when the key is absent. A writer does not add an absent optional key to
  a file it saves.

## Versions

The **format version** is the manifest's `version`. It is **4**, and this
document defines version 4 only. A manifest with any other `version` is refused
before anything else in it is read. There is no conversion from version 3.

The version changes only when an old file would be misread, or a new file would
lose data, under the old rules. An added optional field does neither, so it adds
no version ([ADR 0008](docs/adr/0008-v4-only-and-optional-fields-add-no-version.md)):
an old archive still loads, and a newer archive that uses the field is refused
by an older reader with `manifest/unknown-key`, not misread. A reader that
refuses an archive that way should say that the archive may come from a newer
version and that upgrading may let it load.

Packages that implement the format carry their own version, separate from the
format version. A package release can change without the format changing.

## Format rules

A reader that refuses an archive names the rule it broke by its **rule id**. The
id is the contract; the wording of the message is not. When an archive breaks
more than one rule, which one is reported is not specified.

| Rule id | The archive is refused because |
| :--- | :--- |
| `archive/empty` | the bytes are empty. |
| `archive/not-zip` | the bytes are not a readable zip. |
| `archive/no-manifest` | the zip has no `manifest.json` at its root. |
| `manifest/not-json` | `manifest.json` is not UTF-8 JSON: it does not parse, holds a byte that is not UTF-8, or starts with a byte-order mark. |
| `manifest/version` | `version` is not 4, including a manifest that is not a JSON object. |
| `manifest/unknown-key` | an object holds a key this document does not define. |
| `manifest/duplicate-id` | two sensors, or two labels in one image, share an `id`. |
| `manifest/provenance` | a label's `provenance` is missing or not one of the three, or `proposed_by` is present on `human`, or missing or empty on `proposed` or `corrected`. |
| `manifest/schema` | any other field is missing, has the wrong type or is out of range: no `scale`, an unknown scale name, an empty `id`, a `camera_height_mm` of 0 or below, a non-integer resolution, a number too large to be finite such as `1e999`. |

Two rules are about the images, and a reader reports them instead of refusing
the archive. It loads the archive and lists each disagreement, by its file name,
under its rule id:

| Rule id | Reported when |
| :--- | :--- |
| `images/missing` | the manifest names an image the zip does not hold. |
| `images/orphan` | the zip holds a file other than `manifest.json` that no image names. |

A reader that parses a manifest on its own, without a zip, applies every rule
except `archive/empty`, `archive/not-zip`, `archive/no-manifest`,
`images/missing` and `images/orphan`.

## Scales and gauge

The prototype's standard gauge is **1435 mm**. A model's track gauge in mm is
the standard gauge divided by its scale's ratio.

| Scale | Ratio | Track gauge |
| :--- | ---: | ---: |
| `G` | 1:25 | 57.40 mm |
| `O` | 1:48 | 29.90 mm |
| `S` | 1:64 | 22.42 mm |
| `HO` | 1:87 | 16.49 mm |
| `T` | 1:120 | 11.96 mm |
| `N` | 1:160 | 8.97 mm |
| `Z` | 1:220 | 6.52 mm |

These seven names are every valid `layout.scale`. Compute the gauge from the
ratio; the third column is rounded.

## The calibration fit

**DPT** (dots per track) is image pixels per track gauge, measured on the
reference plane. It is not stored. Every reader computes it from the reference
points with the one fit below, so that every reader filters on the same number.

Let `h` be `camera_height_mm`, possibly absent; `z_ref` be `reference_height_mm`,
0 when absent; and `gauge` be the model's track gauge in mm.

### Which points enter the fit

A point is **left out**, for the first of these reasons that applies:

1. **Off the reference plane.** `h` is absent and the point's `z` is not `z_ref`.
   Without a camera height the fit can speak only about the plane the reference
   height names. The point stays in the archive; it just does not count.
2. **At or above the camera.** `h` is present and the point's `z` is `h` or more.
3. **No partner.** No other point that passed 1 and 2 has the same `z`.

Heights compare exactly; they are typed by hand.

The **pairs** are every unordered pair of points that were not left out and share
the same `z`. Two points at different heights never form a pair: they are at
different depths, so their pixel separation is not a scale times a distance.

### DPT

For each pair `i, j`:

```
d_px  = distance between px_i and px_j                (image pixels)
d_mm  = distance between world_i and world_j in x, y  (mm; z is equal)
d_px' = d_px · (h − z) / h      when h is present, otherwise d_px
```

Under a camera at height `h`, a length at height `z` looks `z / (h − z)` too
large. `d_px'` removes that, scaling every pair to layout zero, which is what
lets pairs at different heights enter one fit. Then:

```
s   = Σ(d_px' · d_mm) / Σ(d_mm²)       over all pairs
DPT = s · gauge · h / (h − z_ref)      when h is present
DPT = s · gauge                        when h is absent
```

The `d_mm²` weighting trusts long baselines more, because a click is off by a
fixed number of pixels and so a short baseline is proportionally noisier.

DPT **does not resolve**, and is reported as null, when `Σ(d_mm²)` is 0 (no
pairs, or only coincident points), or when `h` is present and is at or below
`z_ref`. Null means the fit cannot answer, not zero.

### Residual

```
residual = sqrt( Σ(d_px' − s · d_mm)² / n )    over the n pairs, in image pixels
```

The residual is null when there are fewer than two pairs, since one pair fits
itself exactly, or when `Σ(d_mm²)` is 0. It is a cross-check, never a rule. A
large residual means a mistyped reference point, or, when points sit at more
than one height, a wrong camera height. When every point shares one height it
cannot see a wrong camera height at all.

### The fit result

A fit reports, together:

* **DPT**, or null.
* **The residual**, or null.
* **The pairs used**, each by its two points.
* **The points left out**, each with which of the three reasons applied.
* **Whether the camera height fits**: null when `h` is absent; otherwise true
  when `h` is above every reference point's `z`, false if not. False is not a
  format error, but it means the camera height or a height was mistyped, and
  the DPT should not be trusted.

## Corpus rules

These apply to archives submitted to this repository, and are checked when one
is. They are not format rules: an archive that breaks one is still valid, and an
outside reader may load it.

### Blocking

A submission under `archives/<handle>/` is refused, with the id shown, unless:

| Rule id | Rule |
| :--- | :--- |
| *a format rule id* | The archive is valid under every [format rule](#format-rules). |
| `archive/id` | The archive has an `id`. |
| `archive/id-collision` | No other archive in the same contributor directory has the same `id`. |
| `labels/provenance` | No label is `proposed`. A person reviews every proposal, which makes it `corrected`. |
| `labels/class` | Every label's `class` is in the [vocabulary](#the-vocabulary). |
| `path/shape` | The file sits at `archives/<handle>/<slug>.r49`. |
| `path/slug` | The file name is lowercase letters, digits and single hyphens, then `.r49`. |
| `path/owner` | `<handle>` is the GitHub handle of whoever submits it. |

### Warnings

A warning is reported and never refuses a submission.

| Rule id | Warns when |
| :--- | :--- |
| `calibration/dpt` | DPT is below the [recommended DPT](#the-recommended-dpt). |
| `calibration/unresolved` | DPT does not resolve. |
| `calibration/off-reference-plane` | Points are left out as off the reference plane, because there is no camera height. |
| `images/incomplete` | Some images are not labeled complete. |

### The recommended DPT

The **recommended DPT** is the DPT the corpus asks contributors to reach. It is
**20**. It is this repository's number, used only for the `calibration/dpt`
warning and the capture table in [CONTRIBUTING.md](CONTRIBUTING.md). It is not a
minimum: an archive below it is accepted.

### The vocabulary

The vocabulary is the tree of classes an author may assign:

```
stock
├── loco
│   ├── steam
│   ├── diesel
│   └── electric
├── passenger
└── freight
```

* A class names one node by its path from the root, its segments joined by `.`:
  `stock`, `stock.loco`, `stock.loco.steam`. A class is in the vocabulary when
  that node exists. `stock` is the root of every class, so `loco.steam` is not
  in it.
* Classes match **segment by segment**: `stock` is a prefix of `stock` and of
  `stock.loco`, never of `stockyard`. A reader mapping classes onto its own
  labels should use the same rule, so that a subtype it does not know rolls up
  to the nearest one it does.
* In the authored tree, a nested object is a subtype and any other value is a
  property of the class it sits under. No class carries a property today.

Plain `stock` is always a correct class. A subtype is a refinement an author was
confident of, and a wrong subtype is worse than none. The vocabulary grows; a
class added later does not change any archive already in the corpus.

## Reader requirements

Some conditions belong to one reader, not to the format or the corpus. This
document does not set them. Set your own:

* **Minimum DPT.** The DPT below which images are too coarse for your model.
  The recommended DPT is a capture target, not anyone's minimum. Filter on the
  fit's DPT and residual as your model needs.
* **Car width.** An archive stores each car's span, not its width. How wide a
  box to draw around a span is a modelling choice.
* **`labeled_complete` filtering.** Whether to train on images that are not
  labeled complete is your choice. In an image labeled complete, everything
  unlabeled is background, verified by a person. In any other image it is not,
  and training on it as background teaches a model that a missed car is not a
  car.
