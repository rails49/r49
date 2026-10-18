#!/usr/bin/env bash
# The packages as they ship: packs @rails49/r49 into <out>/npm and builds
# rails49-r49's sdist and wheel into <out>/pypi, installs each into a clean
# directory, and runs every conformance case against what was installed.
# The gate runs it on a temporary directory; the release workflow publishes
# what it leaves in <out>. Expects @rails49/r49's dist/ to be built.
#
#   ./scripts/check-packages.sh <out>
set -euo pipefail
out=$(mkdir -p "$1" && cd "$1" && pwd)
cd "$(dirname "$0")/.."
repo=$(pwd)

if command -v pnpm >/dev/null; then pnpm=(pnpm); else pnpm=(corepack pnpm); fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

clean=$(mktemp -d "${TMPDIR:-/tmp}/r49-packages.XXXXXX")
trap 'rm -rf "$clean"' EXIT

# TypeScript: the tarball, installed alone, and the runner pointed at it.
rm -rf "$out/npm"
mkdir -p "$out/npm"
(cd packages/r49 && npm pack --silent --pack-destination "$out/npm" >/dev/null)
tarball=$(echo "$out"/npm/*.tgz)
echo '{"private": true}' > "$clean/package.json"
"${pnpm[@]}" --dir "$clean" add --prefer-offline "$tarball" >/dev/null
installed="$clean/node_modules/@rails49/r49"
cmp LICENSE-MIT "$installed/LICENSE"
(
  cd packages/r49
  R49_MODULE="$installed/dist/index.js" \
    node --import ../../scripts/test/register.mjs --test tests/conformance.test.ts
)

# Python: the sdist, the wheel built from it, and the runner in an
# environment holding only the wheel and pytest, run from outside the
# repository so `import r49` can only be the wheel.
rm -rf "$out/pypi"
(cd packages/r49-py && uv build --quiet --out-dir "$out/pypi")
wheel=$(echo "$out"/pypi/*.whl)
(
  cd "$clean"
  uv run --quiet --isolated --no-project --with "$wheel" --with pytest -- \
    python -m pytest -q -p no:cacheprovider "$repo/packages/r49-py/tests/test_conformance.py"
)
