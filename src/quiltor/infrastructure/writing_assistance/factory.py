"""Compose writing assistance from persistence, grammar and feature policy."""

from __future__ import annotations

from pathlib import Path

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.infrastructure.persistence.writing_assistance import SQLiteWritingAssistanceRepository
from quiltor.infrastructure.writing_assistance.installer import ReleaseWritingAssistanceInstaller
from quiltor.infrastructure.writing_assistance.languagetool import (
    LanguageToolManager,
    external_grammar_enabled,
)
from quiltor.modules.writing_assistance.grammar import GrammarBackend, UnavailableGrammar
from quiltor.modules.writing_assistance.service import WritingAssistanceService


def build_writing_assistance(
    data_dir: Path, capabilities: FeatureAvailability
) -> WritingAssistanceService:
    repository = SQLiteWritingAssistanceRepository(data_dir)
    installer = ReleaseWritingAssistanceInstaller(repository.path)
    # WRITING_ASSISTANCE_GRAMMAR is the local LanguageTool: a JAR download and
    # a Java process, which web and store builds may not have. An enabled
    # external server needs neither, only an HTTP request, so it is decided
    # here, where the backend is chosen, and not in the capability policy.
    grammar: GrammarBackend
    if capabilities.is_available(Feature.WRITING_ASSISTANCE_GRAMMAR):
        grammar = LanguageToolManager(data_dir)
    elif external_grammar_enabled():
        grammar = LanguageToolManager(data_dir, local=False)
    else:
        grammar = UnavailableGrammar(data_dir)
    return WritingAssistanceService(repository, installer, grammar)


__all__ = ["build_writing_assistance"]
