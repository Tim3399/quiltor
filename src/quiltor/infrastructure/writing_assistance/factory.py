"""Compose writing assistance from persistence, grammar and feature policy."""

from __future__ import annotations

from pathlib import Path

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.infrastructure.persistence.writing_assistance import SQLiteWritingAssistanceRepository
from quiltor.infrastructure.writing_assistance.installer import CoreWritingAssistanceInstaller
from quiltor.infrastructure.writing_assistance.languagetool import LanguageToolManager
from quiltor.modules.writing_assistance.grammar import UnavailableGrammar
from quiltor.modules.writing_assistance.service import WritingAssistanceService


def build_writing_assistance(
    data_dir: Path, capabilities: FeatureAvailability
) -> WritingAssistanceService:
    repository = SQLiteWritingAssistanceRepository(data_dir)
    installer = CoreWritingAssistanceInstaller(repository.path)
    grammar = (
        LanguageToolManager(data_dir)
        if capabilities.is_available(Feature.WRITING_ASSISTANCE_GRAMMAR)
        else UnavailableGrammar(data_dir)
    )
    return WritingAssistanceService(repository, installer, grammar)


__all__ = ["build_writing_assistance"]
