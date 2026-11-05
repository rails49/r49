# r49

The `.r49` layout archive format, and the corpus of archives that follow it. [`FORMAT.md`](FORMAT.md) defines the format.

## Language

### Archive and corpus

**Layout**:
A model railroad, seen from one camera position. An archive holds one. See [FORMAT § `layout`](FORMAT.md#layout).
_Avoid_: scene

**Archive**:
A `.r49` zip or folder holding one layout's images, calibration, sensors and car labels. See [FORMAT § The archive](FORMAT.md#the-archive).
_Avoid_: project, dataset

**Format**:
The rules every archive follows, independent of any program that reads or writes one. See [FORMAT.md](FORMAT.md).
_Avoid_: schema (for the rules themselves)

**Outside reader**:
A program that reads archives and is not part of this project, such as someone else's model trained on the corpus. See [org ADR-0022](https://github.com/rails49/.github/blob/main/docs/adr/0022-the-r49-format-is-r49s-and-each-consumer-pins-it.md).
_Avoid_: consumer, classifier

**Corpus**:
The archives contributed to `rails49/r49`, which training draws from. See [README](README.md).

**Update**:
A submission that replaces an archive already in the corpus. It has the same id as that archive; its path may differ.
_Avoid_: resubmission, revision

**Corpus rule**:
A requirement an archive must meet to be accepted into the corpus, beyond the format. See [FORMAT § Corpus rules](FORMAT.md#corpus-rules).

**Reader requirement**:
A condition one reader places on the archives it uses, such as a minimum DPT. See [FORMAT § Reader requirements](FORMAT.md#reader-requirements).

**Recommended DPT**:
The DPT the corpus asks contributors to reach. See [FORMAT § The recommended DPT](FORMAT.md#the-recommended-dpt).

**Image**:
One photograph of the layout in an archive. See [FORMAT § Image](FORMAT.md#image).
_Avoid_: frame (for a stored image; a frame is one picture from the live camera)

**Duplicate image**:
An image whose bytes equal another image's in the corpus.
_Avoid_: copy, repeat

**Sensor**:
A point on the layout where occupancy must be reported. See [FORMAT § Sensor](FORMAT.md#sensor).
_Avoid_: detector, block, marker

**Scale**:
The modelling scale of a layout (HO, N, Z, ...), which fixes its ratio to the prototype. See [FORMAT § Scales and gauge](FORMAT.md#scales-and-gauge).

**Prototype**:
The real railway a model represents. See [FORMAT § Scales and gauge](FORMAT.md#scales-and-gauge).

### Tracks

**Track**:
The stored line along the middle of a pair of rails on the layout, as nodes, drawn once per archive and shared by all its images. See [FORMAT § Track](FORMAT.md#track).
_Avoid_: centerline, for the stored line

**Centerline**:
The line along the middle of a pair of rails as an editor draws it, before it is stored.

**Click**:
A point a person marked on the middle of a track, stored with the track as an editor's input. Readers other than the editor ignore it. See [FORMAT § Click](FORMAT.md#click).

**Gap**:
The line between two neighbouring clicks of a track. See [FORMAT § Click](FORMAT.md#click).

**Straight gap**:
A gap the person marked straight, by `straight` on the click that starts it. See [FORMAT § Click](FORMAT.md#click).

**Free gap**:
A gap not marked straight. See [FORMAT § Click](FORMAT.md#click).

### Calibration

**Calibration**:
The reference points that fix a layout's DPT. See [FORMAT § `layout.calibration`](FORMAT.md#layoutcalibration).

**Reference point**:
A point given both as an image position and as a layout position in millimetres. See [FORMAT § `layout.calibration`](FORMAT.md#layoutcalibration).
_Avoid_: control point, calibration marker

**Camera height**:
The distance from layout zero up to the camera. See [FORMAT § `layout.calibration`](FORMAT.md#layoutcalibration).

**Reference height**:
The height of the railhead above layout zero; the plane DPT is reported on. See [FORMAT § `layout.calibration`](FORMAT.md#layoutcalibration).

**DPT**:
Dots per track: image pixels per track gauge, measured on the reference plane. See [FORMAT § The calibration fit](FORMAT.md#the-calibration-fit).
_Avoid_: px/mm, resolution

**Residual**:
How far the reference points disagree with the fitted scale, in image pixels. See [FORMAT § Residual](FORMAT.md#residual).

### Labels

**Car**:
One locomotive, coach or wagon on the layout. See [FORMAT § Car label](FORMAT.md#car-label).
_Avoid_: vehicle, object, stock (for the thing itself)

**Span**:
The two end points of a car label: the ends of the car's visible part. See [FORMAT § Car label](FORMAT.md#car-label).

**Train**:
Cars whose ends coincide. See [FORMAT § Car label](FORMAT.md#car-label).
_Avoid_: consist

**Coupling**:
The end point two cars in a train share. See [FORMAT § Car label](FORMAT.md#car-label).

**Class**:
A dotted name for what a car is, such as `stock.loco.steam`. See [FORMAT § The vocabulary](FORMAT.md#the-vocabulary).

**Stock**:
The root class, under which every class sits. See [FORMAT § The vocabulary](FORMAT.md#the-vocabulary).

**Vocabulary**:
The tree of classes an author may assign. See [FORMAT § The vocabulary](FORMAT.md#the-vocabulary).
_Avoid_: taxonomy, label set

**Provenance**:
How a car label came to exist: `human`, `proposed` (a model's, accepted as is) or `corrected` (a model's, then edited). See [FORMAT § Car label](FORMAT.md#car-label).

**Labeled complete**:
A person's assertion that no car in an image is unlabeled. See [FORMAT § Image](FORMAT.md#image).
