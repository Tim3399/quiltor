import os
import importlib.util
import tempfile
import unittest
from unittest.mock import MagicMock, patch

TYPER_AVAILABLE = importlib.util.find_spec("typer") is not None
if TYPER_AVAILABLE:
    from hosts.cli import main as cli


@unittest.skipUnless(TYPER_AVAILABLE, "The packaged CLI dependency typer is not installed in the minimal server test environment")
class CliLanguageInstallTests(unittest.TestCase):
    def test_default_confirmation_installs_reference_data_and_languagetool(self):
        service = MagicMock()
        service.status.side_effect = [
            {"installed": False, "grammar": {"available": False, "version": "6.6"}},
            {"installed": True, "grammar": {"available": False, "version": "6.6"}},
        ]
        service.install.return_value = {"entries": 8}
        service.install_grammar.return_value = {"version": "6.6"}
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {"QUILTOR_HOME": directory}, clear=False), \
             patch("hosts.cli.main.typer.confirm", return_value=True) as confirm, \
             patch("backend.language.service.LanguageService", return_value=service):
            cli._install_language_step()
        confirm.assert_called_once_with(
            "Deutsche Schreibwerkzeuge einrichten (Wörterbuch, Synonyme, Übersetzung und LanguageTool)?",
            default=True,
        )
        service.install.assert_called_once_with()
        service.install_grammar.assert_called_once_with()
        service.close.assert_called_once_with()

    def test_existing_packages_are_not_downloaded_again(self):
        service = MagicMock()
        service.status.side_effect = [
            {"installed": True, "grammar": {"available": True, "version": "6.6"}},
            {"installed": True, "grammar": {"available": True, "version": "6.6"}},
        ]
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {"QUILTOR_HOME": directory}, clear=False), \
             patch("hosts.cli.main.typer.confirm", return_value=True), \
             patch("backend.language.service.LanguageService", return_value=service):
            cli._install_language_step()
        service.install.assert_not_called()
        service.install_grammar.assert_not_called()
        service.close.assert_called_once_with()

    def test_explicit_no_skips_all_language_installation(self):
        with patch("hosts.cli.main.typer.confirm", return_value=False), \
             patch("backend.language.service.LanguageService") as service:
            cli._install_language_step()
        service.assert_not_called()


if __name__ == "__main__": unittest.main()
