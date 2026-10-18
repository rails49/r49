# r49 — the layout archive corpus

Photographs of model railroad layouts, with the rolling stock in them labeled by
the people who took them. This is the training data behind
[rails49](https://github.com/rails49/occupancy), which detects track occupancy from
a camera instead of from block detectors.

**Everything here is [CC BY 4.0](LICENSE).** Use it, train on it, redistribute
it — credit the photographer.

> ⚠️ The classifier this data feeds does sometimes miss rolling stock and does
> sometimes report phantom trains. Nothing built from this corpus should be
> presented as a safety interlock.

## What a `.r49` is

One zip holding `manifest.json` plus the JPEGs it describes. The manifest is
schema version 4: the layout's scale, a calibration that ties image pixels to
real millimetres, sensor points, and — per image — the cars, each a two-point
span along its centerline carrying a record of who authored it.

You make one with the [editor](https://occupancy.rails49.org). It runs entirely in the
browser; there is no account and nothing is uploaded anywhere. Open a layout,
calibrate it, label the cars, save the file.

## The layout

```
archives/<your-github-handle>/<slug>.r49    submissions
fixtures/<slug>.r49                         the six that seeded this repo
```

The **id inside** an archive is its identity; the path is only where it happens
to live. Renaming or moving a file does not make it a different archive — which
is why the same layout submitted by two people lands in two directories without
anything being wrong.

`fixtures/` is deliberately not under `archives/`. Those six sit below the
minimum resolution and exist so the editor has something to open, not so
anything can train on them. Glob `archives/**/*.r49` and you get real
submissions only. They will be deleted once better data supersedes them.

Five of the six carry **no labels at all**. `lighting.r49` now carries 30, added
by hand — useful for exercising the editor against real labels, and still not a
submission: it is under the minimum resolution and it is here rather than in
`archives/`. Do not train on it.

## Submitting

Open a pull request adding your archive. Read
**[CONTRIBUTING.md](CONTRIBUTING.md)** first — it is short, and the parts that
matter most are not the obvious ones.

CI checks what is mechanical: that the archive parses, that its images resolve,
that no label is unreviewed model output, that every class is in the vocabulary.
It **cannot** check whether your boxes actually land on cars, which is the thing
that decides whether a submission is worth having. That part is a person reading
a sample.

## Notes for anyone consuming this

There is no generated index — the tree is the index. A committed manifest of
what is here would be derived data living in git, drifting from the archives it
describes.

Archives are stored in plain git, not LFS. They are zips, so git cannot delta
them and every revision keeps a full copy forever. That is a deliberate trade
against contributor friction, which is the scarcer resource while the corpus is
small. **Revisit if this repository passes a few hundred MB.**
