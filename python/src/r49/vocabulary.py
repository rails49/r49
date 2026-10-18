"""How the vocabulary is read: the segment-prefix rule and subtypes by shape."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from ._data import VOCABULARY

VocabularyNode = Mapping[str, Any]
"""One node of the vocabulary: subtypes by name, mixed with the node's properties."""


def is_segment_prefix(prefix: str, cls: str) -> bool:
    """Whether ``prefix`` is ``cls`` or one of its dotted ancestors.

    ``stock`` is a segment prefix of ``stock.loco`` and of ``stock``, never of
    ``stockyard``.
    """
    return cls == prefix or cls.startswith(f"{prefix}.")


def vocabulary_subtypes(node: VocabularyNode) -> list[tuple[str, VocabularyNode]]:
    """The subtypes of a node, in authored order.

    A nested object is a subtype; anything else is a property of the node.
    """
    return [
        (name, cast(VocabularyNode, child))
        for name, child in node.items()
        if isinstance(child, Mapping)
    ]


def is_known_class(cls: str, vocabulary: VocabularyNode = VOCABULARY) -> bool:
    """Whether a stored ``class`` names a node of the vocabulary.

    The class is rooted: ``stock.loco.steam`` is known, ``loco.steam`` is not,
    and a property name is never a class.
    """
    if cls == "":
        return False
    node = vocabulary
    for segment in cls.split("."):
        child = next((c for name, c in vocabulary_subtypes(node) if name == segment), None)
        if child is None:
            return False
        node = child
    return True
