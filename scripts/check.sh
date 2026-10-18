#!/usr/bin/env bash
# The gate: everything CI runs except installing the packages into a clean
# directory. @rails49/r49's tests and conformance runner, rails49-r49's ruff,
# black, pyright, tests and conformance runner, r49-validate's tests, the
# comparison of the two packages over the corpus, and r49-validate itself over
# CONTRIBUTING.md's capture table and every corpus archive. The corpus is
# archives/ and fixtures/; conformance/ is not a submission.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null; then pnpm=(pnpm); else pnpm=(corepack pnpm); fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The CI gate job sets up node and pnpm, and uv only for a root pyproject.toml,
# which this repository does not have.
if ! command -v uv >/dev/null && [ "${CI:-}" = true ]; then
  pipx install -q uv
  PATH="$HOME/.local/bin:$PATH"
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
  < <(find archives fixtures -name '*.r49' -print0 2>/dev/null | sort -z)

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
