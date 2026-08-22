import ast
import json
import unittest
from unittest.mock import MagicMock
from pathlib import Path

from quiltor.application.backups import BackupGatewayError
from quiltor.application.documents import RevisionConflict
from quiltor.delivery.http import errors
from quiltor.hosts.web.server import Handler


class StructuredHttpErrorTests(unittest.TestCase):
    def test_http_sources_do_not_construct_legacy_prose_error_fields(self):
        root = Path(__file__).resolve().parents[2] / "src" / "quiltor"
        sources = [
            *(root / "delivery" / "http" / "routes").glob("*.py"),
            root / "hosts" / "web" / "server.py",
        ]
        forbidden = {"fehler", "grund", "errorType"}
        violations = []
        for path in sources:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Dict):
                    continue
                for key in node.keys:
                    if isinstance(key, ast.Constant) and key.value in forbidden:
                        violations.append(f"{path.relative_to(root)}:{key.lineno}: {key.value}")
        self.assertEqual([], violations, "\n".join(violations))

    def test_legacy_prose_is_removed_from_the_machine_readable_envelope(self):
        payload = errors.normalize_payload(
            {"ok": False, "fehler": "widersprüchliche Revision", "code": "conflict"},
            409,
        )
        self.assertEqual(
            payload["error"],
            {"code": "conflict", "retryable": True},
        )
        self.assertNotIn("fehler", payload)

    def test_invalid_json_and_unexpected_failures_have_distinct_safe_contracts(self):
        invalid = errors.from_exception(json.JSONDecodeError("detail", "{", 1))
        unexpected = errors.from_exception(RuntimeError("private implementation detail"))

        self.assertEqual((invalid.status, invalid.code), (400, "request.invalid"))
        self.assertEqual(
            (unexpected.status, unexpected.code),
            (500, "application.internal_error"),
        )
        self.assertNotIn("private implementation detail", json.dumps(unexpected.payload()))

    def test_revision_conflict_runtime_matches_the_registered_golden_fixture(self):
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "contracts/fixtures/application-api/structured-error/revision-conflict.v1.json"
            ).read_text(encoding="utf-8")
        )
        mapped = errors.from_exception(RevisionConflict("manuscript", expected=11, actual=12))

        self.assertEqual(mapped.status, 409)
        self.assertEqual(mapped.payload()["error"], fixture)

    def test_backup_gateway_runtime_matches_the_registered_golden_fixture(self):
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "contracts/fixtures/application-api/structured-error/backup-gateway.v1.json"
            ).read_text(encoding="utf-8")
        )
        mapped = errors.from_exception(
            BackupGatewayError(params={"operation": "upload", "snapshotCreated": True})
        )

        self.assertEqual(mapped.status, 502)
        self.assertEqual(mapped.payload()["error"], fixture)

    def test_an_error_envelope_can_never_claim_http_success(self):
        payload, status = errors.normalize_response(
            {
                "ok": False,
                "error": {"code": "backup.gateway_failed", "retryable": True},
            },
            200,
        )

        self.assertEqual(status, 500)
        self.assertEqual(
            payload["error"],
            {
                "code": "application.invalid_error_status",
                "retryable": True,
            },
        )

    def test_dispatch_translates_an_unhandled_route_failure_to_json(self):
        handler = Handler.__new__(Handler)
        handler.server = MagicMock()
        handler.server.application = MagicMock()
        handler.command = "GET"
        handler.path = "/api/test"
        handler._dispatch_request = MagicMock(side_effect=RuntimeError("private detail"))
        responses = []

        def capture(payload, status=200, headers=None):
            handler._response_status = status
            responses.append((payload, status))

        handler.send_json = capture
        handler._dispatch({}, on_miss=lambda: None)

        self.assertEqual(responses[0][1], 500)
        self.assertEqual(responses[0][0]["error"]["code"], "application.internal_error")
        self.assertNotIn("private detail", json.dumps(responses[0][0]))


if __name__ == "__main__":
    unittest.main()
