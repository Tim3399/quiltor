"""The grammar backend for builds that cannot have one.

LanguageTool is a JVM program: using it means downloading a JAR and launching
the system `java`. A Mac App Store build may do neither -- the download is a
guideline 2.5.2 violation and the launch is a sandbox violation, two
independent rulebooks reaching the same verdict. Rather than let the real
backend fail somewhere deep in a subprocess call, that build gets this.

`status()` is what makes it honest: it reports the feature as unsupported with
a reason, and the frontend hides the grammar section instead of offering a
button that cannot work. Both other methods refuse loudly, so a caller that
ignores `status()` gets a clear error rather than a confusing one.
"""
from __future__ import annotations

from pathlib import Path

from backend.language.grammar.languagetool import (
    JAVA_MINIMUM, LANGUAGETOOL_SHA256, LANGUAGETOOL_URL, LANGUAGETOOL_VERSION,
)

_REASON = ("Die Grammatikprüfung ist in dieser Ausgabe von Quiltor nicht enthalten: "
           "sie benötigt LanguageTool und eine Java-Installation, die diese Ausgabe "
           "weder herunterladen noch starten darf.")


class UnavailableGrammar:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    def status(self) -> dict:
        # Same keys as the LanguageTool backend, so the frontend's GrammarStatus
        # type stays one shape; `supported` is what it branches on.
        return {
            "supported": False, "unsupportedReason": _REASON,
            "available": False, "installed": False, "running": False,
            "version": LANGUAGETOOL_VERSION, "javaVersion": None,
            "javaRequired": JAVA_MINIMUM, "externalConfigured": False,
            "externalEnabled": False,
            "download": {"url": LANGUAGETOOL_URL, "checksum": f"sha256:{LANGUAGETOOL_SHA256}",
                         "license": "LGPL-2.1-or-later"},
        }

    def install(self) -> dict:
        raise PermissionError(_REASON)

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        raise PermissionError(_REASON)

    def close(self) -> None:
        """Nothing was ever started."""
