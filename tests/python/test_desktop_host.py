"""The desktop window's configuration and versioned native bridge."""

import ast
import base64
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from quiltor.hosts.desktop import app
from quiltor.hosts.desktop.bridge import BRIDGE_VERSION, FILE_SAVE, INVOKE, NativeBridge

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_SOURCE = REPO_ROOT / "src" / "quiltor" / "hosts" / "desktop" / "app.py"
CONTRACTS_ROOT = REPO_ROOT / "contracts"
CONTRACT_MANIFEST = json.loads((CONTRACTS_ROOT / "manifest.json").read_text(encoding="utf-8"))
NATIVE_BRIDGE_CONTRACT = next(
    contract
    for contract in CONTRACT_MANIFEST["contracts"]
    if contract["name"] == "host.native-bridge"
)
BRIDGE_FIXTURES = {
    Path(fixture["path"]).name: CONTRACTS_ROOT / fixture["path"]
    for fixture in NATIVE_BRIDGE_CONTRACT["fixtures"]
}


def _fixture(name: str) -> dict[str, Any]:
    return json.loads(BRIDGE_FIXTURES[name].read_text(encoding="utf-8"))


def _main_function() -> ast.FunctionDef:
    tree = ast.parse(APP_SOURCE.read_text(encoding="utf-8"), filename=str(APP_SOURCE))
    return next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main"
    )


class PywebviewDownloadTests(unittest.TestCase):
    def test_pywebview_downloads_stay_off(self):
        webview = SimpleNamespace(settings={"ALLOW_DOWNLOADS": True})
        app.keep_pywebview_downloads_off(webview)
        self.assertIs(webview.settings["ALLOW_DOWNLOADS"], False)

    def test_other_settings_are_left_alone(self):
        webview = SimpleNamespace(
            settings={
                "ALLOW_DOWNLOADS": True,
                "ALLOW_FILE_URLS": True,
                "OPEN_EXTERNAL_LINKS_IN_BROWSER": True,
            }
        )
        app.keep_pywebview_downloads_off(webview)
        self.assertTrue(webview.settings["ALLOW_FILE_URLS"])
        self.assertTrue(webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"])
        self.assertEqual(len(webview.settings), 3)

    def test_the_bridge_is_handed_to_the_window(self):
        create_window = next(
            node
            for node in ast.walk(_main_function())
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create_window"
        )
        self.assertIn("js_api", [keyword.arg for keyword in create_window.keywords])

    def test_the_bridge_learns_its_window(self):
        attached = next(
            (
                node
                for node in ast.walk(_main_function())
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "attach"
            ),
            None,
        )
        self.assertIsNotNone(attached, "main() never calls NativeBridge.attach()")


class NativeBridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.capabilities = MagicMock()
        self.capabilities.is_available.return_value = True
        self.bridge = NativeBridge(self.capabilities, directory=self.home)
        self.bridge.attach(SimpleNamespace())
        self.asked: list[str] = []

    def _answer(self, target: Path | None):
        def choose(name: str):
            self.asked.append(name)
            return None if target is None else str(target)

        self.bridge.choose_path = choose

    def _save(self, name: str, data: bytes, request_id: str = "file-save-test"):
        return self.bridge.invoke(
            {
                "version": BRIDGE_VERSION,
                "id": request_id,
                "operation": FILE_SAVE,
                "payload": {
                    "name": name,
                    "content": base64.b64encode(data).decode("ascii"),
                    "encoding": "base64",
                },
            }
        )

    def test_runtime_constants_match_the_registered_schema(self):
        schema = json.loads(
            (CONTRACTS_ROOT / NATIVE_BRIDGE_CONTRACT["schema"]).read_text(encoding="utf-8")
        )
        request = schema["$defs"]["request"]

        self.assertEqual(NATIVE_BRIDGE_CONTRACT["version"], BRIDGE_VERSION)
        self.assertEqual(request["properties"]["version"]["const"], BRIDGE_VERSION)
        self.assertEqual(request["properties"]["operation"]["const"], FILE_SAVE)
        self.assertEqual(set(request["required"]), {"version", "id", "operation", "payload"})

    def test_registered_request_and_success_fixtures_are_executable(self):
        request = _fixture("request.v1.json")
        target = self.home / request["payload"]["name"]
        self._answer(target)

        response = self.bridge.invoke(request)

        self.assertEqual(response, _fixture("success.v1.json"))
        self.assertEqual(target.read_bytes(), base64.b64decode(request["payload"]["content"]))

    def test_request_id_is_echoed_and_bytes_are_written(self):
        target = self.home / "Kapitel.md"
        self._answer(target)

        response = self._save("Kapitel.md", "# Kapitel\n\nGrüße\n".encode(), "correlation-42")

        self.assertEqual(response["version"], BRIDGE_VERSION)
        self.assertEqual(response["id"], "correlation-42")
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], {"status": "saved"})
        self.assertEqual(target.read_text(encoding="utf-8"), "# Kapitel\n\nGrüße\n")
        self.assertEqual(self.asked, ["Kapitel.md"])

    def test_binary_arrives_intact(self):
        target = self.home / "Buch.pdf"
        self._answer(target)
        payload = b"%PDF-1.7\n\x00\x01\xfe\xff binary \n%%EOF"

        response = self._save("Buch.pdf", payload)

        self.assertTrue(response["ok"])
        self.assertEqual(target.read_bytes(), payload)

    def test_cancelling_is_a_successful_native_outcome(self):
        self._answer(None)

        response = self._save("Kapitel.md", b"Text")

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], {"status": "cancelled"})
        self.assertNotIn("error", response)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_a_failing_dialog_returns_a_structured_error(self):
        def explode(name: str):
            raise RuntimeError("private traceback detail")

        self.bridge.choose_path = explode
        response = self._save("Kapitel.md", b"Text", "dialog-7")

        self.assertEqual(response["id"], "dialog-7")
        self.assertEqual(response["error"]["code"], "file.dialog_failed")
        self.assertNotIn("private traceback detail", json.dumps(response))

    def test_a_weird_dialog_value_never_reaches_path_or_javascript(self):
        self.bridge.choose_path = lambda _name: {"path": "C:/private/book.md"}

        response = self._save("Kapitel.md", b"Text", "weird-dialog")

        self.assertEqual(response["id"], "weird-dialog")
        self.assertEqual(response["error"]["code"], "file.dialog_failed")
        self.assertNotIn("path", json.dumps(response))

    def test_unwritable_location_matches_registered_error_fixture(self):
        self._answer(self.home / "missing-folder" / "Kapitel.md")
        fixture = _fixture("error.v1.json")

        response = self._save("Kapitel.md", b"Text", fixture["id"])

        self.assertEqual(response, fixture)

    def test_broken_base64_is_rejected(self):
        target = self.home / "Buch.pdf"
        self._answer(target)
        response = self.bridge.invoke(
            {
                "version": 1,
                "id": "decode-1",
                "operation": "file.save",
                "payload": {
                    "name": "Buch.pdf",
                    "content": "not base64 at all!!",
                    "encoding": "base64",
                },
            }
        )

        self.assertEqual(response["error"]["code"], "file.decode_failed")
        self.assertFalse(target.exists())

    def test_without_a_window_it_reports_a_retryable_not_ready_error(self):
        bridge = NativeBridge(self.capabilities, directory=self.home)
        response = bridge.invoke(_fixture("request.v1.json"))

        self.assertEqual(response["error"]["code"], "native_bridge.not_ready")
        self.assertTrue(response["error"]["retryable"])

    def test_file_save_is_denied_when_effective_capability_is_unavailable(self):
        self.capabilities.is_available.return_value = False
        target = self.home / "denied.md"
        self._answer(target)

        response = self._save("denied.md", b"secret")

        self.assertEqual(response["error"]["code"], "native_bridge.capability_unavailable")
        self.assertFalse(target.exists())
        self.assertEqual(self.asked, [])

    def test_unsupported_version_is_correlated(self):
        request = {**_fixture("request.v1.json"), "version": 2, "id": "future-client"}

        response = self.bridge.invoke(request)

        self.assertEqual(response["version"], BRIDGE_VERSION)
        self.assertEqual(response["id"], "future-client")
        self.assertEqual(response["error"]["code"], "native_bridge.unsupported_version")
        self.assertEqual(response["error"]["params"], {"supported": BRIDGE_VERSION})

    def test_unknown_operation_and_malformed_payload_are_structured(self):
        request = _fixture("request.v1.json")
        unsupported = self.bridge.invoke({**request, "operation": "window.destroy"})
        malformed = self.bridge.invoke({**request, "payload": {"name": "Kapitel.md"}})

        self.assertEqual(unsupported["error"]["code"], "native_bridge.unsupported_operation")
        self.assertEqual(malformed["error"]["code"], "file.invalid_payload")

    def test_the_next_export_starts_where_the_last_one_landed(self):
        folder = self.home / "Manuskripte"
        folder.mkdir()
        self._answer(folder / "Kapitel.md")
        self._save("Kapitel.md", b"Text")
        self.assertEqual(self.bridge._directory, folder)

    def test_only_the_versioned_invoke_method_reaches_the_page(self):
        exposed = [
            name
            for name in dir(self.bridge)
            if not name.startswith("_")
            and getattr(getattr(self.bridge, name), "_serializable", True)
        ]
        self.assertEqual(exposed, [INVOKE])


if __name__ == "__main__":
    unittest.main()
