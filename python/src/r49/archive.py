"""Loading an archive: a zip of ``manifest.json`` and the images it names."""

from __future__ import annotations

import io
import json
import os
import zipfile
import zlib
from typing import Any

from . import errors
from .errors import FormatError
from .manifest import Manifest, parse_manifest


def _reject_constant(name: str) -> Any:
    # Python's json accepts NaN and Infinity; JSON does not.
    raise ValueError(f"{name} is not JSON")


def manifest_from_json(text: str | bytes) -> Manifest:
    """Parse and validate the bytes of a bare ``manifest.json``."""
    try:
        if isinstance(text, bytes):
            text = text.decode("utf-8")
        data = json.loads(text, parse_constant=_reject_constant)
    except ValueError as err:
        raise FormatError(errors.MANIFEST_JSON, f"manifest.json is not JSON: {err}") from None
    return parse_manifest(data)


class Archive:
    """A loaded, validated archive. Read-only."""

    def __init__(self, zip_file: zipfile.ZipFile, manifest: Manifest) -> None:
        self._zip = zip_file
        self.manifest = manifest

    def entries(self) -> list[str]:
        """Every file in the zip, ``manifest.json`` included. Directories are omitted."""
        return [info.filename for info in self._zip.infolist() if not info.is_dir()]

    def image(self, filename: str) -> bytes | None:
        """An image's bytes by its manifest filename, or ``None`` if the zip lacks it."""
        try:
            return self._zip.read(filename)
        except KeyError:
            return None


def load(source: bytes | str | os.PathLike[str]) -> Archive:
    """Load and validate an archive from its bytes or a path.

    Raises :class:`FormatError` naming the format rule the archive broke.
    A path that cannot be read raises the usual ``OSError``.
    """
    if not isinstance(source, bytes):
        with open(source, "rb") as file:
            source = file.read()
    if len(source) == 0:
        raise FormatError(errors.ZIP, "Cannot load .r49 archive: data is empty")
    try:
        zip_file = zipfile.ZipFile(io.BytesIO(source))
        try:
            raw = zip_file.read("manifest.json")
        except KeyError:
            raise FormatError(
                errors.MANIFEST_MISSING, "manifest.json not found in archive"
            ) from None
    except (zipfile.BadZipFile, zipfile.LargeZipFile, zlib.error, EOFError, OSError) as err:
        raise FormatError(errors.ZIP, f"Not a readable .r49 archive: {err}") from None
    return Archive(zip_file, manifest_from_json(raw))
