#!/usr/bin/env bash
# The packages' version: printed when packages/r49/package.json and
# packages/r49-py/pyproject.toml agree on it, a failure when they do not.
set -euo pipefail
cd "$(dirname "$0")/.."

ts=$(node -p "require('./packages/r49/package.json').version")
py=$(sed -n 's/^version = "\(.*\)"$/\1/p' packages/r49-py/pyproject.toml)

if [ "$ts" != "$py" ]; then
  echo "@rails49/r49 is $ts but rails49-r49 is $py; bump both together" >&2
  exit 1
fi
echo "$ts"
