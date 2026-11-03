# Car box geometry

r49 does not define a car's width or the box drawn around a span. There is no
standard car width in `data.json`, and no `carWidthPx`, `spanCorners` or
`spanToPolygon` in either package.

## Why this is out of scope

An archive stores each car's span, the two ends of its visible part, and not
its width. [FORMAT.md § Reader requirements](../FORMAT.md#reader-requirements)
leaves the width to each reader as a modelling choice. The detector draws a
box 3000 mm wide at prototype scale, the widest real stock, so that its boxes
lean toward `occupied`. That is the detector's choice, made for its own output.
Another reader may want a different width or no box at all.

The classifier is such a reader. It labels a position along a track as
occupied when a car's span, projected onto the track, comes within 2 G of it
(rails49/classifier#3). It uses no width.

So the box geometry stays in `@rails49/detector`, with
`layout.standard_width` in its `config.yaml`. occupancy imports it from there,
as it imports `boxCorners` and the runtime.

## Prior requests

- #53: "Own the car box geometry: carWidthPx, spanToPolygon, standard width"
