import os
import importlib.util
import tempfile
import unittest
from unittest.mock import MagicMock, patch

TYPER_AVAILABLE = importlib.util.find_spec("typer") is not None
if TYPER_AVAILABLE:
    from quiltor.hosts.cli import main as cli
    from quiltor.infrastructure.platform.runtime_target import ProcessRole


@unittest.skipUnless(
    TYPER_AVAILABLE,
    "The packaged CLI dependency typer is not installed in the minimal server test environment",
)
class CliWritingAssistanceInstallTests(unittest.TestCase):
    def test_local_assistant_setup_uses_the_cli_process_role(self):
        installation = MagicMock()
        capabilities = object()
        with (
            patch("quiltor.hosts.cli.main.typer.confirm", return_value=True),
            patch(
                "quiltor.bootstrap.build_feature_availability",
                return_value=capabilities,
            ) as availability,
            patch(
                "quiltor.bootstrap.build_assistant_installation",
                return_value=installation,
            ) as build_installation,
        ):
            cli._install_llm_step()

        availability.assert_called_once_with(process_role=ProcessRole.CLI)
        build_installation.assert_called_once_with(capabilities)
        installation.install_selected.assert_called_once_with("auto")

    def test_default_confirmation_installs_reference_data_and_languagetool(self):
        service = MagicMock()
        service.status.side_effect = [
            {"installed": False, "grammar": {"available": False, "version": "6.6"}},
            {"installed": True, "grammar": {"available": False, "version": "6.6"}},
        ]
        service.install.return_value = {"entries": 8}
        service.install_grammar.return_value = {"version": "6.6"}
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"QUILTOR_HOME": directory}, clear=False),
            patch("quiltor.hosts.cli.main.typer.confirm", return_value=True) as confirm,
            patch("quiltor.bootstrap.build_feature_availability") as capabilities,
            patch("quiltor.bootstrap.build_writing_assistance_service", return_value=service),
        ):
            cli._install_writing_assistance_step()
        confirm.assert_called_once_with(
            "Deutsche Schreibwerkzeuge einrichten (Wörterbuch, Synonyme, Übersetzung und LanguageTool)?",
            default=True,
        )
        service.install.assert_called_once_with()
        service.install_grammar.assert_called_once_with()
        service.close.assert_called_once_with()
        capabilities.assert_called_once_with(process_role=ProcessRole.CLI)

    def test_existing_packages_are_not_downloaded_again(self):
        service = MagicMock()
        service.status.side_effect = [
            {"installed": True, "grammar": {"available": True, "version": "6.6"}},
            {"installed": True, "grammar": {"available": True, "version": "6.6"}},
        ]
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"QUILTOR_HOME": directory}, clear=False),
            patch("quiltor.hosts.cli.main.typer.confirm", return_value=True),
            patch("quiltor.bootstrap.build_feature_availability") as capabilities,
            patch("quiltor.bootstrap.build_writing_assistance_service", return_value=service),
        ):
            cli._install_writing_assistance_step()
        service.install.assert_not_called()
        service.install_grammar.assert_not_called()
        service.close.assert_called_once_with()
        capabilities.assert_called_once_with(process_role=ProcessRole.CLI)

    def test_explicit_no_skips_writing_assistance_installation(self):
        with (
            patch("quiltor.hosts.cli.main.typer.confirm", return_value=False),
            patch("quiltor.bootstrap.build_writing_assistance_service") as service,
        ):
            cli._install_writing_assistance_step()
        service.assert_not_called()


if __name__ == "__main__":
    unittest.main()
