# r49

The `.r49` layout archive format, and the corpus of archives that follow it. Terms are copied from [rails49/occupancy's `CONTEXT.md`](https://github.com/rails49/occupancy/blob/main/CONTEXT.md), which keeps the terms this repository does not need (detector, sensor states, drift and so on). [`FORMAT.md`](FORMAT.md) defines the format itself.

## Language

### Archive and corpus

**Archive**:
A `.r49` file holding one layout's images, calibration, sensors and car labels.
_Avoid_: project, dataset

**Format**:
The rules every archive follows, independent of any program that reads or writes one.
_Avoid_: schema (for the rules themselves)

**Outside reader**:
A program that reads archives and is not part of this project, such as someone else's model trained on the corpus.
_Avoid_: consumer, classifier

**Corpus**:
The archives contributed to `rails49/r49`, which training draws from.

**Corpus rule**:
A requirement an archive must meet to be accepted into the corpus, beyond the format. Corpus rules keep archives consistent with each other, such as every class being in the vocabulary.

**Reader requirement**:
A condition one reader places on the archives it uses, such as a minimum DPT. The corpus may report it but never enforces it.

**Recommended DPT**:
The DPT the corpus asks contributors to reach. A submission below it is warned, never refused. Set by the corpus, separately from any reader's minimum DPT.

**Image**:
One photograph of the layout in an archive.
_Avoid_: frame (for a stored image; a frame is one picture from the live camera)

**Scale**:
The modelling scale of a layout (HO, N, Z, ...), which fixes its ratio to the prototype.

### Calibration

**Calibration**:
The reference points that fix a layout's DPT.

**Reference point**:
A point given both as an image position and as a layout position in millimetres.
_Avoid_: control point, calibration marker

**Camera height**:
The distance from layout zero up to the camera.

**Reference height**:
The height of the railhead above layout zero; the plane DPT is reported on.

**DPT**:
Dots per track: image pixels per track gauge, measured on the reference plane.
_Avoid_: px/mm, resolution

**Residual**:
How far the reference points disagree with the fitted scale, in image pixels.

### Labels

**Span**:
The two end points of a car label.

**Class**:
A dotted name for what a car is, such as `stock.loco.steam`.

**Stock**:
The root class. Every new car is `stock`, and every class sits under it.

**Vocabulary**:
The tree of classes an author may assign.
_Avoid_: taxonomy, label set

**Provenance**:
How a car label came to exist: `human`, `proposed` (a model's, accepted as is) or `corrected` (a model's, then edited).

**Labeled complete**:
A person's assertion that no car in an image is unlabeled. Only a person can make it.
