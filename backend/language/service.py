from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from . import storage
from .installer import install
from .grammar import LanguageToolManager
from .registry import MANIFEST_VERSION, SOURCES, manifest

class LanguageService:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "language" / "writing.sqlite3"
        self.grammar = LanguageToolManager(data_dir)

    def status(self) -> dict:
        installed_version = storage.version(self.path)
        return {"installed": installed_version == MANIFEST_VERSION, "stale": installed_version is not None and installed_version != MANIFEST_VERSION, "version": installed_version, "manifest": manifest(), "sources": SOURCES, "grammar": self.grammar.status()}

    def install(self) -> dict:
        result = install(self.path)
        self._lookup.cache_clear()
        return {"ok": True, **result}

    def lookup(self, language: str, mode: str, query: str) -> dict:
        query = " ".join(query.split())
        if language not in {"de-DE", "en-GB"} or mode not in {"dictionary", "synonyms", "translation"} or not query or len(query) > 200:
            raise ValueError("invalid language lookup")
        if storage.version(self.path) != MANIFEST_VERSION: raise FileNotFoundError("language data is not installed or outdated")
        return {"ok": True, "query": query, "language": language, "mode": mode, "version": storage.version(self.path), "results": list(self._lookup(language, mode, query.casefold()))}

    @lru_cache(maxsize=512)
    def _lookup(self, language: str, mode: str, query: str) -> tuple:
        return tuple(storage.lookup(self.path, language, mode, query))

    def install_grammar(self) -> dict: return self.grammar.install()

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        return self.grammar.check(language, text, custom_words)

    def close(self) -> None: self.grammar.close()
