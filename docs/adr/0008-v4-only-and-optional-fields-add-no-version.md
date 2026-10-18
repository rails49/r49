# v4 only, and an optional field adds no version

Moved from rails49/occupancy, where it was ADR 0008, by [ADR 0018](0018-the-r49-format-is-defined-in-rails49-r49.md). Issue numbers below are occupancy's.

A reader or writer of the format handles manifest version 4 and nothing else. A v3 point marker has neither extent nor orientation, so it cannot be migrated; the six fixtures were converted once, in occupancy, by a script that was then deleted. Every object in the manifest is strict, so unknown keys are rejected rather than stripped, because stripping them would delete what a newer build wrote at the next save.

The version changes only when an old file would be misread or a new file would lose data. An added optional field, such as `camera_height_mm`, does neither, and with `version` a literal and no compatibility code, a bump would make every v4 archive fail to load. An optional field has no default a reader writes back, which would add the key on the first save of any archive opened.

Decided in [#8](https://github.com/rails49/occupancy/issues/8) and [#139](https://github.com/rails49/occupancy/issues/139).
