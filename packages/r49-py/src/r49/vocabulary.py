"""How the class vocabulary in ``data.json`` is read.

Not parse-time validation: ``class`` is a plain string in the format, and the
vocabulary is a corpus rule (FORMAT.md § Car label).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .data import VOCABULARY

VocabularyNode = Mapping[str, Any]
"""One mapping in the vocabulary: subtypes by name, mixed with the node's own
properties."""


def is_segment_prefix(prefix: str, cls: str) -> bool:
    """Whether ``prefix`` is ``cls`` or one of its dotted ancestors, segment by
    segment: ``stock`` prefixes ``stock.loco`` and ``stock``, never ``stockyard``."""
    return cls == prefix or cls.startswith(f"{prefix}.")


def vocabulary_subtypes(node: VocabularyNode) -> list[tuple[str, VocabularyNode]]:
    """The subtypes of a node, in authored order. A nested mapping is a
    subtype; anything else is a property, such as ``width_mm``."""
    return [(name, child) for name, child in node.items() if isinstance(child, Mapping)]


def is_known_class(cls: str, vocabulary: VocabularyNode = VOCABULARY) -> bool:
    """Whether a stored class names an entry of the vocabulary, matching segment
    by segment from the root: ``loco.steam`` names nothing, ``stock.loco.steam``
    does."""
    if cls == "":
        return False
    node = vocabulary
    for segment in cls.split("."):
        child = dict(vocabulary_subtypes(node)).get(segment)
        if child is None:
            return False
        node = child
    return True
