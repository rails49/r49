# The format is defined here

Status: accepted. Decided in rails49/occupancy ADR 0018, which this records on the side the decision moved to.

An outside reader should not have to read `rails49/occupancy` to understand an archive. This repository therefore owns the format: [FORMAT.md](../../FORMAT.md), one data file ([`data/r49.json`](../../data/r49.json)) holding the scales, the standard gauge, the vocabulary and the recommended DPT, a TypeScript package that reads and writes, a Python package that only reads, and conformance cases both must pass. Neither package declares a value from the data file in code; both ship the file and read it.

DPT is a reader requirement, not a corpus rule. The corpus reports it and warns below its own recommended DPT, and never refuses on it. Car width, the standard width and span-to-box geometry stay with the occupancy detector, which chooses them.

The code is MIT. The archives and FORMAT.md stay CC BY 4.0.

ADR [0001](0001-v4-only-and-optional-fields-add-no-version.md) and [0002](0002-camera-height-corrects-scale.md) came with the format, from occupancy's ADR 0008 and 0015. Their issue links point at `rails49/occupancy`.
