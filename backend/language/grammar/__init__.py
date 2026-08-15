"""Grammar checking, in the two forms it can take.

LanguageTool needs to download a JAR and launch the system JVM. A direct build
may do both; a store build may do neither -- guideline 2.5.2 forbids the
download and the App Sandbox forbids the launch. So the choice is made here,
once, from the edition policy, and nothing downstream asks about editions again.

This is the shape every capability in the codebase should have: a contract, one
module per implementation, and a selector that reads policy rather than
hard-coding a distribution name.
"""
from __future__ import annotations

from pathlib import Path

from backend import edition
from backend.language.grammar.contract import GrammarBackend
from backend.language.grammar.languagetool import LanguageToolManager
from backend.language.grammar.unavailable import UnavailableGrammar


def backend_for(data_dir: Path) -> GrammarBackend:
    """The grammar backend this build is allowed to use.

    Both policy questions have to hold: downloading the JAR is executable-code
    download, and running it is an out-of-bundle process launch. The Microsoft
    Store build fails the first and so lands here too, even though its sandbox
    would tolerate the second.
    """
    if edition.allows_code_download() and edition.allows_external_process():
        return LanguageToolManager(data_dir)
    return UnavailableGrammar(data_dir)


__all__ = ["GrammarBackend", "LanguageToolManager", "UnavailableGrammar", "backend_for"]
