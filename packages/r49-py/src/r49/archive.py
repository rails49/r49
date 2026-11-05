"""Loading a ``.r49`` archive: ``manifest.json`` and the images it names, read one
file at a time from a zip, a folder or a base URL."""

from __future__ import annotations

import errno
import io
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path
from typing import Protocol

from .errors import ImageMismatch, R49Error
from .manifest import Manifest, parse_manifest, stays_in_archive

MANIFEST_FILE = "manifest.json"

_HTTP_TIMEOUT_SECONDS = 60


def _lzma_errors() -> tuple[type[Exception], ...]:
    """What a damaged lzma entry raises. A Python built without lzma has no such
    error: zipfile raises RuntimeError for an lzma entry there."""
    try:
        from lzma import LZMAError
    except ImportError:
        return ()
    return (LZMAError,)


_UNREADABLE_ZIP = (
    zipfile.BadZipFile,
    zlib.error,
    EOFError,
    ValueError,
    NotImplementedError,
    RuntimeError,
    *_lzma_errors(),
)


def _is_dot_path(name: str) -> bool:
    """Whether a segment of ``name`` starts with a dot, which a folder and a base URL
    ignore."""
    return any(segment.startswith(".") for segment in name.split("/"))


class _Files(Protocol):
    """Where an archive's files come from. Holds nothing open between calls."""

    def read(self, name: str) -> bytes | None:
        """The bytes of the file at ``name``, or None when there is none."""
        ...

    def names(self) -> list[str] | None:
        """Every file there is, or None for a source that cannot be listed."""
        ...


class _Zip:
    """A zip, opened afresh for each read and read through its central directory."""

    def __init__(self, source: bytes | Path, size: int) -> None:
        self._source = source
        self._size = size
        try:
            with self._open() as zf:
                infos = [info for info in zf.infolist() if not info.is_dir()]
        except OSError as err:
            # A damaged offset makes zipfile seek before the start of a file.
            if err.errno != errno.EINVAL:
                raise
            raise self._refusal(err) from None
        except _UNREADABLE_ZIP as err:
            raise self._refusal(err) from None
        if any(info.flag_bits & 0x1 for info in infos):
            raise self._refusal("an entry is encrypted")
        self._names = list(dict.fromkeys(info.filename for info in infos))
        self._held = set(self._names)

    def _open(self) -> zipfile.ZipFile:
        source = self._source
        return zipfile.ZipFile(io.BytesIO(source) if isinstance(source, bytes) else source)

    def _refusal(self, reason: object) -> R49Error:
        message = f"Failed to read .r49 archive (size: {self._size} bytes): {reason}"
        return R49Error("archive/not-zip", message)

    def read(self, name: str) -> bytes | None:
        if name not in self._held:
            return None
        try:
            with self._open() as zf:
                try:
                    return zf.read(name)
                except OSError as err:
                    # bz2 reports a damaged stream as a bare OSError, and a damaged
                    # offset makes zipfile seek before the start of a file. Any other
                    # OSError is the disk's, and no verdict on the archive.
                    bz2 = zf.getinfo(name).compress_type == zipfile.ZIP_BZIP2
                    if not bz2 and err.errno != errno.EINVAL:
                        raise
                    raise self._refusal(err) from None
        except _UNREADABLE_ZIP as err:
            raise self._refusal(err) from None

    def names(self) -> list[str]:
        return self._names


class _Folder:
    """A folder, which ignores any path with a segment that starts with a dot."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def read(self, name: str) -> bytes | None:
        if _is_dot_path(name):
            return None
        try:
            return (self._root / name).read_bytes()
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError, ValueError):
            return None

    def names(self) -> list[str]:
        found: list[str] = []
        for directory, subdirectories, files in os.walk(self._root):
            subdirectories[:] = [d for d in subdirectories if not d.startswith(".")]
            found += [
                Path(directory, file).relative_to(self._root).as_posix()
                for file in files
                if not file.startswith(".")
            ]
        return sorted(found)


class _Url:
    """A base URL, read one request at a time, which ignores a dot path as a folder
    does. A 404 is an absent file; any other failure raises, as it says nothing about
    the archive."""

    def __init__(self, base: str) -> None:
        self._base = base.rstrip("/")

    def read(self, name: str) -> bytes | None:
        if _is_dot_path(name):
            return None
        path = "/".join(urllib.parse.quote(segment, safe="") for segment in name.split("/"))
        try:
            with urllib.request.urlopen(
                f"{self._base}/{path}", timeout=_HTTP_TIMEOUT_SECONDS
            ) as response:
                return response.read()
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            raise

    def names(self) -> None:
        return None


class R49Archive:
    """A loaded archive, read-only. Get one from :func:`load`. It keeps no file
    open between reads, so there is nothing to close."""

    def __init__(self, manifest: Manifest, files: _Files) -> None:
        self._manifest = manifest
        self._files = files

    @property
    def manifest(self) -> Manifest:
        """The validated manifest."""
        return self._manifest

    def entries(self) -> list[str]:
        """Every file in the archive, ``manifest.json`` included, in zip order or,
        in a folder, sorted, leaving out dot paths. Directories are left out. A URL
        cannot be listed: there it is ``manifest.json`` and the names in the
        manifest."""
        names = self._files.names()
        if names is not None:
            return list(names)
        named = [image.filename for image in self._manifest.images]
        return list(dict.fromkeys([MANIFEST_FILE, *named]))

    def image(self, filename: str) -> bytes | None:
        """The bytes of the file at ``filename``, inflating or fetching only that
        file, or None when the archive has none, the name would leave it, or a
        folder or base URL ignores it as a dot path.

        :raises R49Error: ``archive/not-zip`` if a zip's file is damaged.
        :raises OSError: if a path cannot be read; that is no verdict on an archive.
        :raises Exception: from a base URL, any failure other than a 404 raises
            something other than an ``R49Error``, such as an ``OSError``,
            ``http.client.InvalidURL`` or ``UnicodeEncodeError``; that is no verdict
            on an archive either.
        """
        return self._files.read(filename) if stays_in_archive(filename) else None

    def image_mismatches(self) -> list[ImageMismatch]:
        """Every way the manifest and the archive disagree about which images it
        holds: ``images/missing`` for each image entry whose file the archive
        lacks, in manifest order, then ``images/orphan`` for each file other
        than ``manifest.json`` that no image names, in the order of
        :meth:`entries`. Empty for an archive that follows both rules, and for a
        URL, which FORMAT.md exempts from both.

        Reported, not raised: :func:`load` accepts an archive with either."""
        present = self._files.names()
        if present is None:
            return []
        named = [image.filename for image in self._manifest.images]
        held, referenced = set(present), set(named)
        missing = [ImageMismatch("images/missing", name) for name in named if name not in held]
        orphan = [
            ImageMismatch("images/orphan", path)
            for path in present
            if path != MANIFEST_FILE and path not in referenced
        ]
        return missing + orphan


def load(source: bytes | str | os.PathLike[str]) -> R49Archive:
    """Load an archive from a zip's bytes or path, a folder's path, or an
    ``http://`` or ``https://`` base URL, with its scheme in any case, applying
    every format rule but the two image rules, which
    :meth:`R49Archive.image_mismatches` reports. Reads the manifest and no image: a
    damaged image in a zip is refused when it is read.

    :raises R49Error: naming the format rule the archive breaks.
    :raises OSError: if a path cannot be read; that is no verdict on an archive.
    :raises Exception: from a base URL, any failure other than a 404 raises
        something other than an ``R49Error``, such as an ``OSError``,
        ``http.client.InvalidURL`` or ``UnicodeEncodeError``; that is no verdict on
        an archive either.
    """
    files = _files_of(source)
    manifest = files.read(MANIFEST_FILE)
    if manifest is None:
        raise R49Error("archive/no-manifest", "manifest.json not found in archive")
    return R49Archive(parse_manifest(manifest), files)


def _files_of(source: bytes | str | os.PathLike[str]) -> _Files:
    if isinstance(source, str) and source.lower().startswith(("http://", "https://")):
        return _Url(source)
    if isinstance(source, bytes):
        size = len(source)
        zipped = source
    else:
        zipped = Path(source)
        if zipped.is_dir():
            return _Folder(zipped)
        size = zipped.stat().st_size
    if size == 0:
        raise R49Error("archive/empty", "Cannot load .r49 archive: data is empty")
    return _Zip(zipped, size)
