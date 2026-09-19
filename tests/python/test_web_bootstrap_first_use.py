from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity
from quiltor.bootstrap.web import build_web_application
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


class WebBootstrapFirstUseTests(unittest.TestCase):
    def test_default_build_does_not_install_assistant_and_core_writing_works(self):
        installation = MagicMock()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch(
                "quiltor.bootstrap.web.build_assistant_installation",
                return_value=installation,
            ),
        ):
            app = build_web_application(
                identity=build_identity(oidc_enabled=False, master_token="a" * 64),
                inference=MagicMock(),
                app_directories=_directories(Path(temporary)),
            )
            try:
                installation.ensure_installed.assert_not_called()
                app.prepare()
                created = app.application.worlds.create("First project", "", config.LOCAL_OWNER)
                opened = app.application.worlds.open(created["id"], config.LOCAL_OWNER)
                current = app.application.documents.load(
                    "manuscript", opened.paths.documents.database
                )
                self.assertEqual(
                    app.application.documents.save(
                        "manuscript",
                        current.state,
                        current.revision,
                        opened.paths.documents,
                    ),
                    1,
                )
            finally:
                app.close()


if __name__ == "__main__":
    unittest.main()
