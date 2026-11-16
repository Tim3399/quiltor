from __future__ import annotations

from functools import lru_cache

from .grammar import GrammarBackend
from .ports import WritingAssistanceInstaller, WritingAssistanceRepository
from .registry import CORE_VERSION, DATA, DataRelease, data_status

# The dictionary layout this service reads in full; mirrors the persistence
# adapter's DICTIONARY_SCHEMA, which modules may not import.
DICTIONARY_SCHEMA = 2


class WritingAssistanceService:
    def __init__(
        self,
        repository: WritingAssistanceRepository,
        installer: WritingAssistanceInstaller,
        grammar: GrammarBackend,
        data: DataRelease | None = DATA,
    ) -> None:
        self.repository = repository
        self.installer = installer
        self.grammar = grammar
        self.data = data
        # The version an installed database must carry to count as current.
        self.expected_version = data["version"] if data is not None else CORE_VERSION

    def status(self) -> dict:
        installed_version = self.repository.version()
        installed = installed_version == self.expected_version
        # A schema-1 file still answers from ``entries`` but cannot resolve
        # inflected forms, so the UI offers to update it.
        outdated_layout = installed and (self.repository.schema() or 1) < DICTIONARY_SCHEMA
        return {
            "installed": installed,
            # "core" while only the built-in starter set is installed, so the UI
            # can say so instead of letting every other word look unknown.
            "coverage": self.repository.coverage() if installed else None,
            "stale": (installed_version is not None and not installed) or outdated_layout,
            "version": installed_version,
            # What the installed database itself records, for the attribution footer.
            "installed_sources": self.repository.sources() if installed else [],
            # Whether there is a dictionary to download at all: without a
            # published data release the client offers no install button.
            "data": data_status(self.data),
            "grammar": self.grammar.status(),
        }

    def install(self) -> dict:
        result = self.installer.install()
        self._lookup.cache_clear()
        return {"ok": True, **result}

    def lookup(self, language: str, mode: str, query: str) -> dict:
        query = " ".join(query.split())
        if (
            language not in {"de-DE", "en-GB"}
            or mode not in {"dictionary", "synonyms", "translation"}
            or not query
            or len(query) > 200
        ):
            raise ValueError("invalid language lookup")
        # An outdated database still answers: status() reports it as stale and the UI
        # offers the update, but the author keeps the words that are there (T-155).
        if self.repository.version() is None:
            raise FileNotFoundError("language data is not installed")
        return {
            "ok": True,
            "query": query,
            "language": language,
            "mode": mode,
            "version": self.repository.version(),
            "results": list(self._lookup(language, mode, query.casefold())),
        }

    @lru_cache(maxsize=512)  # noqa: B019 - one service per process; install() clears it
    def _lookup(self, language: str, mode: str, query: str) -> tuple:
        return tuple(self.repository.lookup(language, mode, query))

    def install_grammar(self) -> dict:
        return self.grammar.install()

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        return self.grammar.check(language, text, custom_words)

    def close(self) -> None:
        self.grammar.close()
