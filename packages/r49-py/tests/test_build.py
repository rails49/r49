"""The package as it ships: ``uv build`` makes the sdist, then the wheel from
the sdist, and the wheel holds the data file the scale table and vocabulary
are read from."""

from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
DATA = PACKAGE.parent / "r49" / "src" / "data.json"


def test_the_wheel_built_from_the_sdist_holds_the_data_file(tmp_path: Path) -> None:
    subprocess.run(["uv", "build", "--quiet", "--out-dir", str(tmp_path)], cwd=PACKAGE, check=True)
    [_sdist] = tmp_path.glob("*.tar.gz")
    [wheel] = tmp_path.glob("*.whl")
    with zipfile.ZipFile(wheel) as zf:
        assert zf.read("r49/data.json") == DATA.read_bytes()
