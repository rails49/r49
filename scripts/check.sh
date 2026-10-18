#!/usr/bin/env bash
# The gate: CONTRIBUTING.md's capture table and every archive under archives/,
# checked by r49-validate from rails49/occupancy. Locally it uses the sibling
# checkout (override with OCCUPANCY=<path>); in CI it clones one.
set -euo pipefail

if [ "${CI:-}" = true ]; then
  occupancy=$(mktemp -d "${TMPDIR:-/tmp}/occupancy.XXXXXX")
  git clone -q --depth 1 https://github.com/rails49/occupancy "$occupancy"
  (cd "$occupancy" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install \
    --frozen-lockfile --filter "@occupancy/r49-validate...")
else
  # beside the main checkout, so a linked worktree finds it too
  main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  occupancy=${OCCUPANCY:-$main/../occupancy}
fi

v=$(cd "$occupancy/tools/r49-validate" && pwd)
validate=(node --import "$v/node_modules/tsx/dist/loader.mjs" "$v/src/cli.ts")

"${validate[@]}" guidance --check CONTRIBUTING.md

archives=()
while IFS= read -r -d '' path; do archives+=("$path"); done \
  < <(find archives -name '*.r49' -print0 2>/dev/null)
if [ ${#archives[@]} -gt 0 ]; then
  "${validate[@]}" -- "${archives[@]}" >/dev/null
fi
