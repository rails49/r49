#!/usr/bin/env bash
# The gate, which CI runs as it is: @rails49/r49's tests and conformance
# runner; rails49-r49's ruff, black, pyright, tests and conformance runner;
# the same ruff, black and pyright over the validator's read.py; r49-validate's
# tests; the check that every Markdown link goes somewhere; the comparison of
# the two packages over the corpus; and r49-validate itself over
# CONTRIBUTING.md's capture table and every corpus archive.
# `r49-validate list` names the corpus.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null; then pnpm=(pnpm); else pnpm=(corepack pnpm); fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# @rails49/doc-links reads rails49 links through GitHub's REST API.
if [ -z "${GITHUB_TOKEN:-}" ]; then
  GITHUB_TOKEN=$(gh auth token)
  export GITHUB_TOKEN
fi

# TypeScript: build, types, and every package's tests. @rails49/r49's walk the
# conformance cases.
# A modules directory made on another platform is purged and relinked
# without asking.
"${pnpm[@]}" install --frozen-lockfile --config.confirmModulesPurge=false
"${pnpm[@]}" -r build
"${pnpm[@]}" -r typecheck
"${pnpm[@]}" -r test

# Python: rails49-r49's lint, types and tests, which walk the conformance
# cases; and the same lint and types over the validator's read.py.
read_py=../../tools/r49-validate/read.py
(
  cd packages/r49-py
  uv sync --locked
  uv run --locked ruff check --config pyproject.toml . "$read_py"
  uv run --locked black --config pyproject.toml --check . "$read_py"
  uv run --locked pyright . "$read_py"
  uv run --locked pytest -q
)

validate=(node tools/r49-validate/dist/cli.js)

corpus=()
while IFS= read -r -d '' path; do corpus+=("$path"); done \
  < <("${validate[@]}" list)

# The two packages must read every corpus archive alike.
python=$(mktemp "${TMPDIR:-/tmp}/r49-python.XXXXXX")
trap 'rm -f "$python"' EXIT
uv run --project packages/r49-py --locked python tools/r49-validate/read.py \
  "${corpus[@]}" > "$python"
"${validate[@]}" readers --python "$python" "${corpus[@]}"

# The validator: the capture table, then the corpus.
"${validate[@]}" guidance --check CONTRIBUTING.md
if [ ${#corpus[@]} -gt 0 ]; then
  "${validate[@]}" -- "${corpus[@]}" >/dev/null
fi
