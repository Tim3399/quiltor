from .openthesaurus import parse_openthesaurus
from .wiktionary import parse_wiktionary, parse_wiktionary_records, wiktionary_forms

__all__ = [
    "parse_openthesaurus",
    "parse_wiktionary",
    "parse_wiktionary_records",
    "wiktionary_forms",
]
