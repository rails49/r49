"""A local static HTTP server for the tests that read an archive over a URL."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import unquote


class _Handler(SimpleHTTPRequestHandler):
    """Serves a directory, answering 500 for the paths in ``failing`` and adding each
    path requested, decoded, to ``requests``."""

    def __init__(
        self, *args: Any, failing: frozenset[str], requests: list[str], **kwargs: Any
    ) -> None:
        self.failing = failing
        self.requests = requests
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        path = unquote(self.path).lstrip("/")
        self.requests.append(path)
        if path in self.failing:
            self.send_error(500)
        else:
            super().do_GET()

    def log_message(self, format: str, *args: Any) -> None:
        pass


@contextmanager
def served(root: Path, *failing: str, requests: list[str] | None = None) -> Generator[str]:
    """The base URL of ``root``, served until the block ends. ``requests``, if given,
    collects each path requested."""
    handler = partial(
        _Handler,
        directory=str(root),
        failing=frozenset(failing),
        requests=[] if requests is None else requests,
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
