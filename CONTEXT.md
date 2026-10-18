# r49

The corpus of `.r49` layout archives, and the format they are written in: its
written definition ([FORMAT.md](FORMAT.md)), its data file, and the packages that
read it.

## Language

### Archive and format

**Archive**:
A `.r49` file holding one layout's images, calibration, sensors and car labels.
_Avoid_: project, dataset

**Manifest**:
The `manifest.json` inside an archive, which describes everything but the image bytes.

**Format**:
The rules every archive follows, independent of any program that reads or writes one.
_Avoid_: schema (for the rules themselves)

**Format rule**:
A rule of the format. Breaking one makes a file not an archive.

**Rule id**:
The stable name of a rule, such as `format/unknown-key`, given when an archive is refused. The id is the contract; the message is not.

**Format version**:
The manifest's `version`, 4. Separate from the package version.

**Package version**:
The semver version of `@rails49/r49` and `rails49-r49`, released together.

**Conformance case**:
An archive or bare manifest with the result every reader must reach on it.

**Outside reader**:
A program that reads archives and is not part of this project, such as someone else's model trained on the corpus.
_Avoid_: consumer

### Corpus

**Corpus**:
The archives contributed to this repository.

**Corpus rule**:
A requirement an archive must meet to be accepted into the corpus, beyond the format, such as every class being in the vocabulary.

**Reader requirement**:
A condition one reader places on the archives it uses, such as a minimum DPT. The corpus may report it but never enforces it.

**Fixture**:
One of the six archives under `fixtures/`, kept to exercise the code. Below the recommended DPT; not training data.

**Contributor directory**:
`archives/<handle>/`, holding one contributor's submissions. The directory is the attribution record.

### Layout and calibration

**Layout**:
A model railroad as seen by one fixed overhead camera.
_Avoid_: scene

**Image**:
One photograph of the layout in an archive.
_Avoid_: frame (for a stored image)

**Scale**:
The modelling scale of a layout (HO, N, Z, ...), which fixes its ratio to the prototype.

**Prototype**:
The real railway a model represents.

**Standard gauge**:
The prototype track gauge, 1435 mm. A model's gauge is this divided by the scale's ratio.

**DPT**:
Dots per track: image pixels per track gauge, measured on the reference plane.
_Avoid_: px/mm, resolution

**Recommended DPT**:
The DPT the corpus asks contributors to reach. A submission below it is warned, never refused.

**Minimum DPT**:
A reader requirement: the DPT below which one reader's model will not use an image. Not set here.

**Calibration**:
The reference points that fix a layout's DPT.

**Reference point**:
A point given both as an image position and as a layout position in millimetres.
_Avoid_: control point, calibration marker

**Camera height**:
The distance from layout zero up to the camera.

**Reference height**:
The height of the railhead above layout zero; the plane DPT is reported on.

**Calibration fit**:
The one result computed from the calibration: DPT, residual, the pairs used, the reference points left out and why, and whether the camera height fits.

**Residual**:
How far the reference points disagree with the fitted scale, in image pixels.

### Cars and labels

**Car**:
One piece of rolling stock, labeled by its two ends along its centerline.
_Avoid_: vehicle, object, stock (for the thing itself)

**Span**:
The two end points of a car label.

**Class**:
A dotted name for what a car is, such as `stock.loco.steam`.

**Stock**:
The root class. Every class sits under it.

**Vocabulary**:
The tree of classes an author may assign. A corpus rule, not a format rule.
_Avoid_: taxonomy, label set

**Segment prefix**:
`a` is a segment prefix of `b` when `b` is `a` or starts with `a.`. `stock` is one of `stock.loco`, never of `stockyard`.

**Labeled complete**:
A person's assertion that no car in an image is unlabeled. Only a person can make it.

**Provenance**:
How a car label came to exist: `human`, `proposed` (a model's, accepted as is) or `corrected` (a model's, then edited).

**Sensor**:
A point on the layout where occupancy must be reported.
_Avoid_: detector, block, marker
