# Releasing the packages

A tag `vX.Y.Z` on `main` publishes `@rails49/r49` to npm and `rails49-r49` to
PyPI with version `X.Y.Z`, then makes a GitHub Release with generated notes.
Package versions follow semver and are separate from the format version.

1. In a pull request, set the same version in `packages/r49/package.json` and
   `packages/r49-py/pyproject.toml`. The gate fails if they differ.
2. Merge it.
3. Tag the merge commit on `main` and push the tag:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The [release workflow](../.github/workflows/release.yml) publishes nothing for a
tag that is not `vX.Y.Z`, not on `main`, or not the packages' version. It
publishes the files it ran the conformance cases against.

If one registry's publish fails, re-run that job. Neither registry accepts a
version twice, so a version that was published stays published.
