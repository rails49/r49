# Conformance cases

Inputs with the outcome [FORMAT.md](../FORMAT.md) gives them. An implementation
of the format in any language runs every case here and agrees with each one.
The TypeScript runner is [`packages/r49/tests/conformance.ts`](../packages/r49/tests/conformance.ts),
run by `pnpm test`; the Python one is
[`packages/r49-py/tests/test_conformance.py`](../packages/r49-py/tests/test_conformance.py),
run by `uv run pytest` there.

## A case

Each directory under `cases/` is one case. It holds exactly one input:

* `archive.r49`: archive bytes, to be loaded as an archive. They are not always
  a zip; some cases exist to be refused as `archive/zip`.
* `manifest.json`: a bare manifest, to be parsed on its own. FORMAT.md exempts
  a bare manifest from `archive/zip`, `manifest/missing`, `images/missing` and
  `images/orphan`. A runner whose implementation reads manifests only inside an
  archive may zip the bytes as `manifest.json` beside a placeholder for every
  image the manifest names, which is what the TypeScript runner does.

and `expected.json`:

```jsonc
{
  "description": "…",            // what the case is about; not checked
  "result": "accept",            // or "reject"
  "rule": "manifest/field",      // reject only: the format rule id
  "dpt": 164.9425287356322,      // accept only: DPT, or null where it does not resolve
  "residual": null,              // accept only: the residual, or null
  "tolerance": 1e-9              // absolute; applies to dpt and residual when either is a number
}
```

A case **agrees** when:

* the outcome is `result`;
* on reject, the rule id reported is `rule`;
* on accept, each of `dpt` and `residual` that is present is `null` when the
  implementation's is null, and otherwise within `tolerance` of it. Absent
  means not checked.

Cases assert rule ids, never message text: the id is the contract, the wording
is not. Every format rule id has at least one rejecting case, and each rejecting
case breaks exactly one rule, since FORMAT.md does not say which rule is
reported when several are broken.

## The cases

The names say what each is about: `accept-*`; `reject-*`, named after the rule
broken; `fit-*` for the calibration fit; and `height-*` for the fit with a
camera height.
`accept-written-by-typescript` is an archive `@rails49/r49`'s writer exported,
with that package's DPT and residual.
`format-v4` is the frozen archive rails49/occupancy wrote in August 2026; it is
never regenerated, and its [README](cases/format-v4/README.md) says why.

The DPT and residual in the `fit-*` and `height-*` cases were computed from
FORMAT.md § The calibration fit by an implementation separate from this
repository's package, and agree with it.

## Adding a case

Add a directory with an input and `expected.json`, and say in `description`
what the case shows. A new format rule needs a rejecting case before it is
done. Never change an existing case's input or expectation to make an
implementation pass: a case that changes changes the format.

## Licence

The cases are [CC BY 4.0](../LICENSE), like the format they test.
