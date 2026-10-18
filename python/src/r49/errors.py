"""The one exception a refused archive raises, and the rule ids it carries."""

from __future__ import annotations

from typing import Final

ZIP: Final = "format/zip"
MANIFEST_MISSING: Final = "format/manifest-missing"
MANIFEST_JSON: Final = "format/manifest-json"
VERSION: Final = "format/version"
UNKNOWN_KEY: Final = "format/unknown-key"
DUPLICATE_ID: Final = "format/duplicate-id"
PROVENANCE: Final = "format/provenance"
FIELD: Final = "format/field"

RULES: Final = (
    ZIP,
    MANIFEST_MISSING,
    MANIFEST_JSON,
    VERSION,
    UNKNOWN_KEY,
    DUPLICATE_ID,
    PROVENANCE,
    FIELD,
)
"""Every format rule id, as FORMAT.md § Format rule ids defines them."""


class FormatError(ValueError):
    """An archive or manifest broke a format rule.

    ``rule`` is one of :data:`RULES` and is the contract; the message may be
    reworded in any release.
    """

    rule: str

    def __init__(self, rule: str, message: str) -> None:
        super().__init__(message)
        self.rule = rule
