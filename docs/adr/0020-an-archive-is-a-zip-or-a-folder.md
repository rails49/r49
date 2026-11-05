# An archive is a zip or a folder

Resolves [#59](https://github.com/rails49/r49/issues/59), under the map [rails49/.github#60](https://github.com/rails49/.github/issues/60).

An archive was a zip. An occupancy service keeps its archive on a server and a person adds images to it, and adding one image to a zip rewrites the whole file, about 90 MB for the ceiling archives. So an archive may also be a folder named `*.r49`, with the same contents and rules. A server adds an image without rewriting the rest, and any static server serves the files one at a time, so the per-file HTTP form needs no API of its own.

`version` stays 4, under [ADR 0008](0008-v4-only-and-optional-fields-add-no-version.md): a reader that knows only zips refuses a folder and misreads nothing. The corpus stays zip only.
