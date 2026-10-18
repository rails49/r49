#!/usr/bin/env bash
# The gate: the Python package and the corpus validator pass their tests and
# the conformance cases, CONTRIBUTING.md's capture table matches data/r49.json,
# and every archive under fixtures/ and archives/ passes r49-validate. Nothing
# here checks out rails49/occupancy. Needs uv; the workspace is locked in uv.lock.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v uv >/dev/null || { echo "check.sh needs uv: https://docs.astral.sh/uv/" >&2; exit 2; }
run=(uv run --locked --quiet)

"${run[@]}" --package rails49-r49 pytest -q python
"${run[@]}" --package r49-validate pytest -q tools/r49-validate

validate=("${run[@]}" --package r49-validate r49-validate)
"${validate[@]}" guidance --check CONTRIBUTING.md

archives=()
while IFS= read -r -d '' path; do archives+=("$path"); done \
  < <(find fixtures archives -name '*.r49' -print0 2>/dev/null | sort -z)
if [ ${#archives[@]} -gt 0 ]; then
  "${validate[@]}" -- "${archives[@]}" >/dev/null
fi
