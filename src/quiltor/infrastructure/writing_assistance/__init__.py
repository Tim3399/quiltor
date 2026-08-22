"""Concrete writing-assistance adapters and their composition helper."""

from quiltor.infrastructure.writing_assistance.factory import build_writing_assistance
from quiltor.infrastructure.writing_assistance.languagetool import LanguageToolManager

__all__ = ["LanguageToolManager", "build_writing_assistance"]
