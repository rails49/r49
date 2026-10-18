# Contributing

Everything here comes down to one thing CI cannot check: **do the boxes actually
land on the cars?** The mechanical checks are just there to keep obvious
breakage out of the way of that question.

## Capturing

**Frame a short stretch of track.** A car needs enough pixels across it to be
located reliably, and that is a fact about your camera and your scale, not about
your layout. The widest strip of track that may span one frame:

<!-- BEGIN GENERATED — do not edit by hand.
     Produced from the repository root by:
       uv run --quiet --package r49-validate r49-validate guidance
     CI diffs this block against that command's output. It is derived from
     recommended_dpt and the scale table in data/r49.json. -->

Reference frame: **1920 px** wide. Recommended DPT: **20**.

| Scale | Ratio | Track gauge | Widest track that may span the frame |
| :--- | ---: | ---: | ---: |
| G | 1:25 | 57.40 mm | 5510 mm (5.51 m) |
| O | 1:48 | 29.90 mm | 2870 mm (2.87 m) |
| S | 1:64 | 22.42 mm | 2153 mm (2.15 m) |
| HO | 1:87 | 16.49 mm | 1583 mm (1.58 m) |
| T | 1:120 | 11.96 mm | 1148 mm (1.15 m) |
| N | 1:160 | 8.97 mm | 861 mm (0.86 m) |
| Z | 1:220 | 6.52 mm | 626 mm (0.63 m) |

Shoot a **narrower** strip than the figure for your scale and you are above the
recommended DPT; shoot a wider one and cars are too few pixels across to localise
reliably. The numbers scale linearly with image width — at 3840 px they double.

<!-- END GENERATED -->

So for HO: about 1.6 m of track in frame, and a 4K phone roughly doubles that.
The recommended DPT is a target, not a bar: CI warns below it and still accepts
the archive. The editor warns you when you are under its own minimum, so you do
not have to work this out in advance — but it is much easier to frame correctly
than to recapture.

**Calibrate with two points at the same height, as far apart as you can reach.**
Both halves matter. Only points at equal height enter the fit, because under a
camera lens two points at different heights are at different depths and their
separation on screen mixes size with distance. And the fit trusts long baselines
more, because your click is off by a fixed number of pixels either way — so a
short baseline is proportionally noisier.

**One archive is one camera position.** The calibration, the camera and the
sensors are stored per *layout*, not per image, so moving the camera between
shots invalidates all three at once. Vary the lighting and the rolling stock
*within* an archive; a new camera position is a new archive. This is the easiest
way to ruin an otherwise excellent submission.

**Please include some car-free frames.** Clear the track, shoot a few images,
mark them complete, and label nothing. This is the single most valuable thing
you can send and it is not obvious: a picture with no cars in it, asserted
complete, is a *verified* statement about what background looks like — and it
costs you no labeling work at all.

**Image count is a target, not a floor.** A couple of dozen frames across varied
conditions is a good archive. There is no minimum, and a six-image archive of an
unusual layout is worth having.

## Labeling

**Use the most specific class you are confident of — and plain `stock` is a
correct answer, not a lazy one.** Subtypes (`stock.loco.steam`,
`stock.freight`, …) are recorded now and trained on by nothing yet, but they
cannot be backfilled without reopening every image. A *wrong* subtype is worse
than none: a passenger car tagged as freight is noise a future model will learn.
If you cannot tell from the photograph, say `stock` and move on.

If your rolling stock genuinely is not representable in the vocabulary, **open
an issue** rather than approximating. The vocabulary is meant to grow.

**Chain a consist; do not place independent boxes.** Couplings are not labeled
and not detected — they are derived from the endpoints of neighbouring cars
coinciding exactly. The editor's chaining gives you that exactness for free;
two boxes placed separately only come close.

**`labeled_complete` is the one claim only you can make.** Nothing can verify
that *every* car in an image has been labeled, so nothing pretends to. Tick it
when it is true. An image marked complete with zero cars is perfectly valid —
that is the all-background sample asked for above.

**Assisted labeling is welcome, but check every proposal.** A label you accepted
or adjusted is recorded as `corrected` and is fine here. An untouched `proposed`
label — raw model output — **fails CI**, because model output re-entering
training as ground truth is the one loop this corpus exists to prevent.

## Submitting

1. Rename your file to a slug: lowercase, digits, hyphens. `cars 0-10.r49`
   becomes `cars-0-10.r49`. CI blocks anything else, because spaces break the
   tooling that walks the changed files.
2. Put it in `archives/<your-github-handle>/`.
3. Optionally, check it the way CI will. From a checkout of this repository,
   with [uv](https://docs.astral.sh/uv/) installed:

   ```sh
   uv run --package r49-validate r49-validate --author <your-handle> archives/<your-handle>/<slug>.r49
   ```

   Exit 0 means nothing blocks; warnings are printed but do not fail it.
4. Open a pull request and confirm the three statements in the template.

### What review consists of

The maintainer reads CI's table — resolution, calibration residual and
completeness for every archive in your PR — and then opens **three images** in
the editor, including one you marked complete, chosen using that table. They
look at whether the boxes land on cars.

**That is a sample, not an audit.** Most of your images will not be opened by
anyone before they are merged. Saying so plainly is deliberate: responsibility
for the images nobody looked at stays with you, and a review whose scope is
hidden would imply a guarantee nobody is making.

### If something is wrong

You will get **changes requested with a specific comment naming a specific
image**, not a closed PR. Almost everything is fixable — a low-resolution
archive can be recaptured, a sloppy box fixed in the editor — and closing would
signal a finality the situation rarely has.

Two things do get a PR closed: a **licence or consent problem** (photographs you
did not take, or identifiable people in frame), which is not fixable by
adjusting the file; and **abandonment**, after a stated wait.

## Licence

By opening a pull request you license the images and labels in it under
[CC BY 4.0](LICENSE). You keep the copyright; anyone may use the material with
credit. Note that this covers the *data* — the code in this repository is MIT, and the
rails49 editor and the model weights trained from this corpus are AGPL-3.0, for
reasons that have nothing to do with your photographs.
