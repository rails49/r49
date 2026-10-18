"""The corpus's own rules about *where* a file sits, as opposed to what is inside it.

These live in the validator rather than in the workflow so that a path
violation lands in the same report as everything else, and so that tests cover
them. Nothing here knows about GitHub: the pull request author's handle arrives
as a parameter.
"""

from __future__ import annotations

import re

from .report import Finding, Scope

# Lowercase, hyphen-separated, no spaces. Whitespace is what this exists to
# stop: `git diff --name-only` piped into a shell loop splits on the spaces in
# `cars 0-10.r49`.
_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.r49$")


def _segments(path: str) -> list[str]:
    # `\` is tolerated for Windows contributors.
    return [s for s in path.replace("\\", "/").split("/") if s not in ("", ".")]


def scope_of(path: str) -> Scope:
    """Which bar this path is held to.

    ``fixtures/`` sits outside ``archives/`` deliberately: the six are zero-label
    and below the recommended DPT, and a consumer's default glob of
    ``archives/**`` must not silently ingest them.
    """
    parts = _segments(path)
    if len(parts) == 3 and parts[0] == "archives":
        return "archives"
    if len(parts) == 2 and parts[0] == "fixtures":
        return "fixtures"
    return "unknown"


def handle_of(path: str) -> str | None:
    """The contributor directory a submission sits in, or ``None`` outside ``archives/``."""
    return _segments(path)[1] if scope_of(path) == "archives" else None


def check_path(path: str, author: str | None) -> list[Finding]:
    """The path rules.

    ``author`` is the pull request author's handle, or ``None`` when unknown (a
    local run). Unknown skips only the ownership rule.
    """
    parts = _segments(path)
    scope = scope_of(path)

    if scope == "unknown":
        return [
            Finding(
                "path/shape",
                f"{path} is not a place the corpus defines. A submission goes in "
                f"archives/<your-github-handle>/<slug>.r49; fixtures/<slug>.r49 is reserved for "
                f"the six archives that came from rails49.",
            )
        ]

    findings: list[Finding] = []
    filename = parts[-1]
    if not _SLUG.match(filename):
        findings.append(
            Finding(
                "path/slug",
                f"{filename} is not a slug. Rename it to lowercase letters, digits and hyphens — "
                f'"cars 0-10.r49" becomes "cars-0-10.r49". Spaces in particular break shell '
                f"tooling that walks the changed files.",
            )
        )

    if scope == "archives" and author is not None and parts[1] != author:
        findings.append(
            Finding(
                "path/owner",
                f"{path} is under archives/{parts[1]}/, but this pull request is from @{author}. "
                f"Submit your archives under archives/{author}/ — the directory is the "
                f"attribution record CC BY 4.0 asks for.",
            )
        )

    return findings
