"""The one error this package raises for an archive that breaks a format rule."""

from __future__ import annotations

from typing import Final, Literal, get_args

FormatRuleId = Literal[
    "archive/zip",
    "manifest/missing",
    "manifest/json",
    "manifest/version",
    "manifest/unknown-key",
    "manifest/duplicate-id",
    "manifest/provenance",
    "manifest/field",
    "images/missing",
    "images/orphan",
]
"""A format rule id, as FORMAT.md § Format rules lists them."""

FORMAT_RULE_IDS: Final[tuple[FormatRuleId, ...]] = get_args(FormatRuleId)
"""Every format rule id, in FORMAT.md's order.

The id is the contract; the wording of a message is not. A caller that needs to
tell one refusal from another switches on :attr:`R49Error.rule`, never on the
text.
"""


class R49Error(Exception):
    """An archive or manifest broke a format rule. Anything else raised is a bug
    or a misuse, not a verdict on the archive."""

    rule: FormatRuleId
    """The format rule the archive or manifest broke."""

    def __init__(self, rule: FormatRuleId, message: str) -> None:
        super().__init__(message)
        self.rule = rule
