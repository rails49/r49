"""The one error this package raises for an archive that breaks a format rule,
and the image mismatches an archive reports instead of raising."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, get_args

FormatRule = Literal[
    "archive/empty",
    "archive/not-zip",
    "archive/no-manifest",
    "manifest/not-json",
    "manifest/version",
    "manifest/unknown-key",
    "manifest/duplicate-id",
    "manifest/provenance",
    "manifest/schema",
    "images/missing",
    "images/orphan",
]
"""A format rule id, as FORMAT.md § Format rules lists them."""

FORMAT_RULES: Final[tuple[FormatRule, ...]] = get_args(FormatRule)
"""Every format rule id, in FORMAT.md's order.

The id is the contract; the wording of a message is not. A caller that needs to
tell one refusal from another switches on :attr:`R49Error.rule`, never on the
text.
"""


class R49Error(Exception):
    """An archive or manifest broke a format rule. Anything else raised is a bug
    or a misuse, not a verdict on the archive."""

    rule: FormatRule
    """The format rule the archive or manifest broke."""

    def __init__(self, rule: FormatRule, message: str) -> None:
        super().__init__(message)
        self.rule = rule


@dataclass(frozen=True)
class ImageMismatch:
    """One way the manifest and the zip disagree about which images an archive
    holds. Reported by :meth:`R49Archive.image_mismatches`, never raised."""

    rule: Literal["images/missing", "images/orphan"]
    filename: str
    """The manifest filename, or the zip entry, the disagreement is about."""
