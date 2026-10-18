"""What rails49-r49, the Python package, makes of each archive named on the
command line, as JSON on stdout: the outcomes ``r49-validate readers`` compares
with the TypeScript package's (``src/readers.ts``).

    uv run --project packages/r49-py --locked python tools/r49-validate/read.py PATH...

A refusal is an R49Error; anything else raised is a bug, not a verdict, and
fails the run.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import r49


def outcome(path: str) -> dict[str, Any]:
    try:
        archive = r49.load(path)
    except r49.R49Error as err:
        return {
            "path": path,
            "result": "reject",
            "rule": err.rule,
            "dpt": None,
            "residual": None,
        }
    result = r49.fit(archive.manifest)
    return {
        "path": path,
        "result": "accept",
        "rule": None,
        "dpt": result.dpt,
        "residual": result.residual,
    }


if __name__ == "__main__":
    json.dump([outcome(path) for path in sys.argv[1:]], sys.stdout, indent=2)
    sys.stdout.write("\n")
