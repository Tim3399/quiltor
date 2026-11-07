"""GET /api/capabilities: the flags the client branches on (T-102, D-58, D-59).

Each operation profile answers exactly its contract fixture, and every install
flag comes from the same function as the `installable` its status route reports.
"""

import json
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

from quiltor.delivery.http import routes as api_routes
from tests.python.test_operator_only_routes import _InstallStubs
from tests.python.test_server_auth import _LiveAuthServerTestCase

FIXTURES = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "fixtures"
    / "application-api"
    / "capabilities"
)


def _fixture(profile: str) -> dict:
    return json.loads((FIXTURES / f"{profile}.v1.json").read_text(encoding="utf-8"))


class CapabilitiesRegistrationTest(unittest.TestCase):
    def test_the_route_needs_a_session_but_no_world(self):
        api_routes.load()
        registration = api_routes.GET["/api/capabilities"]
        self.assertFalse(registration.anonymous)
        self.assertFalse(registration.world)
        self.assertFalse(registration.auth_only)
        self.assertFalse(registration.operator_only)


class SingleUserCapabilitiesTest(_InstallStubs):
    def setUp(self):
        super().setUp()
        self.writing.status.return_value = {
            "installed": False,
            "grammar": {"installed": False, "available": False},
        }
        cast(MagicMock, self.application.assistant).status.return_value = {"available": False}
        self.installation.is_configured.return_value = False

    def capabilities(self) -> tuple[int, dict, dict]:
        status, headers, raw = self.request("GET", "/api/capabilities")
        return status, headers, json.loads(raw)

    def test_local_answers_the_local_fixture(self):
        status, headers, body = self.capabilities()
        self.assertEqual(status, 200)
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertEqual(body, _fixture("local"))

    def test_desktop_answers_the_desktop_fixture(self):
        self.application.operation_profile = "desktop"
        _, _, body = self.capabilities()
        self.assertEqual(body, _fixture("desktop"))

    def test_a_hosted_profile_turns_off_sync_and_every_install(self):
        # The profile alone, without OIDC: the flags follow it, not multi_user.
        self.application.operation_profile = "hosted"
        _, _, body = self.capabilities()
        instance = body["instance"]
        self.assertIs(instance["deviceSync"], False)
        self.assertIs(instance["assistantInstall"], False)
        self.assertIs(instance["writingDataInstall"], False)
        self.assertIs(instance["grammarInstall"], False)
        self.assertEqual(body["user"], {})

    def test_each_install_flag_equals_the_installable_of_its_status_route(self):
        for profile in ("local", "desktop", "hosted"):
            self.application.operation_profile = profile
            with self.subTest(profile=profile):
                _, _, body = self.capabilities()
                _, _, writing = self.request("GET", "/api/writing-assistance/status")
                _, _, assistant = self.request(
                    "GET", f"/api/assistant/status?world={self.world_id}"
                )
                writing, assistant = json.loads(writing), json.loads(assistant)
                instance = body["instance"]
                self.assertIs(instance["assistantInstall"], assistant["installable"])
                self.assertIs(instance["writingDataInstall"], writing["installable"])
                self.assertIs(instance["grammarInstall"], writing["grammar"]["installable"])


class HostedCapabilitiesTest(_LiveAuthServerTestCase):
    def test_without_a_session_the_answer_is_401_like_whoami(self):
        for path in ("/api/capabilities", "/api/whoami"):
            with self.subTest(path=path):
                status, _, body, _ = self._request("GET", path)
                self.assertEqual(status, 401)
                self.assertFalse(json.loads(body)["ok"])

    def test_a_signed_in_user_gets_the_hosted_fixture(self):
        session_value = self._login("user-alice")
        status, headers, body, _ = self._request(
            "GET", "/api/capabilities", cookies={"quiltor_session": session_value}
        )
        self.assertEqual(status, 200)
        self.assertEqual({k.lower(): v for k, v in headers.items()}["cache-control"], "no-store")
        self.assertEqual(json.loads(body), _fixture("hosted"))

    def test_user_is_empty_also_without_the_premium_role(self):
        session_value = self._login("user-bob", roles=())
        _, _, body, _ = self._request(
            "GET", "/api/capabilities", cookies={"quiltor_session": session_value}
        )
        self.assertEqual(json.loads(body)["user"], {})


if __name__ == "__main__":
    unittest.main()
