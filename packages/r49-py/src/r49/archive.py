"""Loading a ``.r49`` archive: a zip of ``manifest.json`` and the images it names."""

from __future__ import annotations

import io
import os
import zipfile
import zlib
from pathlib import Path

from .errors import R49Error
from .manifest import Manifest, parse_manifest

MANIFEST_FILE = "manifest.json"


class R49Archive:
    """A loaded archive, read-only. Get one from :func:`load`."""

    def __init__(self, manifest: Manifest, files: dict[str, bytes]) -> None:
        self._manifest = manifest
        self._files = files

    @property
    def manifest(self) -> Manifest:
        """The validated manifest."""
        return self._manifest

    def entries(self) -> list[str]:
        """Every file in the zip, ``manifest.json`` included, in zip order.
        Directory entries are left out."""
        return list(self._files)

    def image(self, filename: str) -> bytes | None:
        """The bytes of the file at ``filename``, or None when the zip has none."""
        return self._files.get(filename)


def load(source: bytes | str | os.PathLike[str]) -> R49Archive:
    """Load an archive from its bytes or from a path, applying every format rule.

    :raises R49Error: naming the format rule the archive breaks.
    :raises OSError: if a path cannot be read; that is no verdict on an archive.
    """
    data = source if isinstance(source, bytes) else Path(source).read_bytes()
    if not data:
        raise R49Error("archive/zip", "Cannot load .r49 archive: data is empty")
    files = _read_zip(data)

    if MANIFEST_FILE not in files:
        raise R49Error("manifest/missing", "manifest.json not found in archive")
    manifest = parse_manifest(files[MANIFEST_FILE])

    # Every image the manifest names is in the zip, and every file in the zip
    # but the manifest is an image it names.
    named = dict.fromkeys(image.filename for image in manifest.images)
    missing = [name for name in named if name not in files]
    if missing:
        raise R49Error(
            "images/missing", f"The manifest names images the archive lacks: {', '.join(missing)}"
        )
    orphan = [path for path in files if path != MANIFEST_FILE and path not in named]
    if orphan:
        raise R49Error(
            "images/orphan", f"The archive holds files no image names: {', '.join(orphan)}"
        )
    return R49Archive(manifest, files)


def _read_zip(data: bytes) -> dict[str, bytes]:
    """Every file in the zip by path. Read whole on load, so that a zip that
    cannot be read is refused here rather than when an image is asked for."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return {info.filename: zf.read(info) for info in zf.infolist() if not info.is_dir()}
    except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError) as err:
        raise R49Error(
            "archive/zip", f"Failed to load .r49 archive (size: {len(data)} bytes): {err}"
        ) from None
