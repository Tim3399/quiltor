import tempfile
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

from quiltor.bootstrap import build_identity
from quiltor.bootstrap.web import build_web_application
from quiltor.infrastructure.inference.installation import LocalAssistantInstallation
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.platform.ports import AppDirectories


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root / "data",
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


class WebApplicationInstanceIsolationTests(unittest.TestCase):
    def test_composed_instances_keep_persistence_and_install_state_separate(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_dirs = _directories(Path(first))
            second_dirs = _directories(Path(second))
            first_app = build_web_application(
                identity=build_identity(oidc_enabled=False, master_token="a" * 64),
                ensure_assistant_installed=False,
                inference=MagicMock(),
                app_directories=first_dirs,
            )
            second_app = build_web_application(
                identity=build_identity(oidc_enabled=False, master_token="b" * 64),
                ensure_assistant_installed=False,
                inference=MagicMock(),
                app_directories=second_dirs,
            )
            try:
                first_app.prepare()
                second_app.prepare()
                first_app.application.worlds.create("First", "", config.LOCAL_OWNER)

                self.assertEqual(first_app.data_directory, first_dirs.data.resolve())
                self.assertEqual(second_app.data_directory, second_dirs.data.resolve())
                self.assertEqual(len(first_app.application.worlds.list(config.LOCAL_OWNER)), 1)
                self.assertEqual(second_app.application.worlds.list(config.LOCAL_OWNER), [])
                self.assertIsNot(
                    first_app.assistant_installation,
                    second_app.assistant_installation,
                )
                first_installation = cast(
                    LocalAssistantInstallation, first_app.assistant_installation
                )
                second_installation = cast(
                    LocalAssistantInstallation, second_app.assistant_installation
                )
                self.assertIsNot(first_installation.coordinator, second_installation.coordinator)
            finally:
                first_app.close()
                second_app.close()


if __name__ == "__main__":
    unittest.main()
