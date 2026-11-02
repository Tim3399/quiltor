"""Installing software is the operator's job on a hosted server (D-59, T-101).

Every route that installs something is marked `operator_only`. In the `hosted`
operation profile the dispatch refuses it with `403 install.forbidden_hosted`
before the route runs and before any body is read; locally it runs as before.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock, patch

from quiltor.bootstrap.application import AssistantServices, build_identity
from quiltor.bootstrap.web import build_web_application
from quiltor.delivery.http import routes as api_routes
from quiltor.hosts.web import server
from tests.python.test_server_logging import _directories, _LiveServer

# The install endpoints, each with the call on the application that does the work.
INSTALL_ENDPOINTS = {
    "/api/assistant/install": ("assistant_installation", "start_async"),
    "/api/writing-assistance/install": ("writing_assistance", "install"),
    "/api/writing-assistance/grammar/install": ("writing_assistance", "install_grammar"),
}


class OperatorOnlyTableTest(unittest.TestCase):
    def test_every_install_route_is_operator_only(self):
        api_routes.load()
        install_paths = {
            path
            for table in (api_routes.GET, api_routes.SAVE)
            for path in table
            if "install" in path
        }
        # The status probe reads only; it stays open so a hosted client can show "Bereit".
        install_paths.discard("/api/assistant/install/status")
        self.assertEqual(install_paths, set(INSTALL_ENDPOINTS))
        for path in sorted(install_paths):
            registration = api_routes.SAVE.get(path) or api_routes.GET[path]
            with self.subTest(path=path):
                self.assertTrue(registration.operator_only, f"{path} is not operator_only")

    def test_reading_routes_are_not_operator_only(self):
        api_routes.load()
        self.assertFalse(api_routes.GET["/api/assistant/install/status"].operator_only)
        self.assertFalse(api_routes.GET["/api/writing-assistance/status"].operator_only)


class _InstallStubs(_LiveServer):
    def setUp(self):
        super().setUp()
        self.installation = MagicMock()
        self.installation.start_async.return_value = True
        self.writing = MagicMock()
        self.writing.install.return_value = {"ok": True}
        self.writing.install_grammar.return_value = {"ok": True}
        self.application.assistant_installation = self.installation
        self.application.writing_assistance = self.writing

    def installer(self, path):
        owner, method = INSTALL_ENDPOINTS[path]
        return getattr(getattr(self.application, owner), method)


class HostedInstallTest(_InstallStubs):
    def setUp(self):
        super().setUp()
        self.application.operation_profile = "hosted"

    def test_hosted_refuses_every_install_endpoint_without_reading_the_body(self):
        for path in INSTALL_ENDPOINTS:
            with self.subTest(path=path):
                self.fresh()
                with patch.object(
                    server.Handler, "_read_json_body", side_effect=AssertionError("body read")
                ) as read_body:
                    status, _, raw = self.request("POST", path, {"worldId": self.world_id})
                self.assertEqual(status, 403)
                self.assertEqual(json.loads(raw)["error"]["code"], "install.forbidden_hosted")
                self.assertFalse(json.loads(raw)["error"]["retryable"])
                read_body.assert_not_called()
                self.installer(path).assert_not_called()
                line = self.only("install.forbidden_hosted")
                self.assertEqual(line["level"], "warning")
                self.assertEqual(line["route"], path)


class LocalInstallTest(_InstallStubs):
    def test_local_runs_every_install_endpoint(self):
        for profile in ("local", "desktop"):
            self.application.operation_profile = profile
            for path in INSTALL_ENDPOINTS:
                with self.subTest(profile=profile, path=path):
                    self.installer(path).reset_mock()
                    status, _, _ = self.request("POST", path, {})
                    self.assertEqual(status, 200)
                    self.installer(path).assert_called_once()


class InstallableStatusTest(_InstallStubs):
    def setUp(self):
        super().setUp()
        self.writing.status.return_value = {
            "installed": False,
            "grammar": {"installed": False, "available": False},
        }
        cast(MagicMock, self.application.assistant).status.return_value = {"available": False}
        self.installation.is_configured.return_value = False

    def statuses(self):
        _, _, writing = self.request("GET", "/api/writing-assistance/status")
        _, _, assistant = self.request("GET", f"/api/assistant/status?world={self.world_id}")
        return json.loads(writing), json.loads(assistant)

    def test_hosted_status_says_not_installable(self):
        self.application.operation_profile = "hosted"
        writing, assistant = self.statuses()
        self.assertIs(writing["installable"], False)
        self.assertIs(writing["grammar"]["installable"], False)
        self.assertIs(assistant["installable"], False)

    def test_local_status_says_installable(self):
        writing, assistant = self.statuses()
        self.assertIs(writing["installable"], True)
        self.assertIs(writing["grammar"]["installable"], True)
        self.assertIs(assistant["installable"], True)


if __name__ == "__main__":
    unittest.main()


class ProfileWiringTest(unittest.TestCase):
    """build_web_application derives the profile from the identity it is given.

    The other tests set `operation_profile` by hand or call `operation_profile_for`
    directly; this one holds the line in between (T-101 review, F-101-1).
    """

    def _profile(self, oidc: bool) -> tuple[str, bool]:
        identity = build_identity(
            oidc, issuer="https://issuer.example", client_id="c", client_secret="s"
        )
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.dict(
                os.environ,
                {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": "https://quiltor.example"},
            ),
            patch(
                "quiltor.bootstrap.web.build_assistant_services",
                return_value=AssistantServices(MagicMock(), MagicMock()),
            ),
        ):
            application = build_web_application(
                identity=identity,
                ensure_assistant_installed=False,
                app_directories=_directories(Path(tmp)),
            )
            try:
                return application.operation_profile, application.installable
            finally:
                application.close()

    def test_oidc_identity_builds_a_hosted_application(self):
        self.assertEqual(self._profile(oidc=True), ("hosted", False))

    def test_single_user_identity_builds_a_local_application(self):
        self.assertEqual(self._profile(oidc=False), ("local", True))
