# What moves here from occupancy takes the licence of its path

Status: accepted.

[rails49/occupancy](https://github.com/rails49/occupancy) is AGPL-3.0 and stays so. Code moved from it into this repository is MIT here, and prose moved from it is CC BY 4.0 here, as the licence table in the [README](../../README.md#licences) assigns by path. This covers `packages/r49/`, including the id generator and data file that came with it; `tools/r49-validate/`; the archive in `conformance/cases/format-v4/`; `FORMAT.md`, written up from occupancy's `SPEC.md` § Format; and ADRs [0008](0008-v4-only-and-optional-fields-add-no-version.md) and [0018](0018-the-r49-format-is-defined-in-rails49-r49.md).

Bernhard Boser (GitHub `iot49`) wrote all of it and holds its copyright personally. occupancy's only other commit, [rails49/occupancy#204](https://github.com/rails49/occupancy/pull/204) by the look bot, changed `pnpm-lock.yaml` and `ui/package.json`; neither moved. Some commits name Claude, an AI tool, in a Co-Authored-By trailer; it is a tool the author used, not a second author. As sole copyright holder, the author licenses the same work under AGPL-3.0 there and under MIT or CC BY 4.0 here, with no other consent needed.

A later move is covered when Bernhard Boser is sole author of every moved line. Anything with another author needs that author's written consent, linked from the pull request that moves it.

## Considered options

- Keep moved code AGPL-3.0 here. Users of `@rails49/r49` and `rails49-r49` would take on AGPL obligations, against ADR 0018's choice of MIT for code.
- Rewrite the code here instead of moving it. That is work with no gain while the author is the same.
