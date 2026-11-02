"""T-71 P3: a refused document save says why in the log, and never with the author's text.

Runs against a live server, the way `test_server_logging` does, so the lines checked
here are the ones an operator would read.
"""

from __future__ import annotations

import json
import unittest
from copy import deepcopy

from quiltor.delivery.http import errors as http_errors
from quiltor.infrastructure.observability import schema as log_schema
from tests.python.test_server_logging import CANARY, _LiveServer

# A user key the log's own pointer rule would let through: if it ever became the
# `field`, it would arrive in the log unaltered rather than as "<invalid>".
POINTER_CANARY = "CANARYkey7f3a"


class DocumentSaveLoggingTests(_LiveServer):
    def setUp(self):
        super().setUp()
        status, _, raw = self.request("GET", f"/api/manuscript?world={self.world_id}")
        self.assertEqual(status, 200)
        self.envelope = json.loads(raw)
        self.path = f"/api/manuscript?world={self.world_id}"

    def put(self, body, headers=None):
        self.fresh()
        return self.request("PUT", self.path, body, headers)

    def assert_no_canary(self):
        logged = json.dumps(self.capture.lines, default=str)
        self.assertNotIn(CANARY, logged)
        self.assertNotIn(POINTER_CANARY, logged)

    def rejected(self, code: str) -> dict:
        line = self.only("document.save_rejected")
        self.assertEqual(line["level"], "warning")
        self.assertEqual(line["document"], "manuscript")
        self.assertEqual(line["code"], code)
        self.assertEqual(line["request_id"], self.only("http.access")["request_id"])
        self.assertLessEqual(set(line) - {"event", "level"}, log_schema.EVENTS[line["event"]])
        self.assertNotIn("<invalid>", line.values())
        return line

    def assert_error_body(self, raw: bytes, status: int, code: str) -> None:
        body = json.loads(raw)
        body["error"].pop("requestId")
        self.assertEqual(body, http_errors.for_status(status, code=code).payload())

    def test_a_valid_save_logs_no_rejection(self):
        status, _, _ = self.put(self.envelope)
        self.assertEqual(status, 200)
        self.assertEqual(self.lines("document.save_rejected"), [])
        self.assertEqual(self.lines("document.save_conflict"), [])

    def test_an_unknown_envelope_key_is_named_by_reason_not_by_its_spelling(self):
        candidate = deepcopy(self.envelope)
        candidate[POINTER_CANARY] = CANARY
        status, _, raw = self.put(candidate)
        self.assertEqual(status, 400)
        self.assert_error_body(raw, 400, "document.invalid_wire")
        line = self.rejected("document.invalid_wire")
        self.assertEqual(line["reason"], "envelope_unknown_field")
        self.assertNotIn("field", line)
        self.assert_no_canary()

    def test_a_broken_payload_points_at_a_schema_key_and_carries_no_text(self):
        candidate = deepcopy(self.envelope)
        candidate["payload"]["hiddenElements"] = [{CANARY: CANARY}]
        candidate["payload"]["chapters"][0]["title"] = CANARY
        status, _, raw = self.put(candidate)
        self.assertEqual(status, 400)
        self.assert_error_body(raw, 400, "document.invalid_wire")
        line = self.rejected("document.invalid_wire")
        self.assertEqual(line["reason"], "payload_invalid")
        self.assertEqual(line["field"], "/payload/hiddenElements")
        self.assert_no_canary()

    def test_a_canary_key_inside_the_payload_never_becomes_the_field(self):
        candidate = deepcopy(self.envelope)
        candidate["payload"][POINTER_CANARY] = [CANARY]
        candidate["payload"]["hiddenElements"] = [1]
        status, _, _ = self.put(candidate)
        self.assertEqual(status, 400)
        line = self.rejected("document.invalid_wire")
        self.assertTrue(line["field"].startswith("/payload"))
        self.assert_no_canary()

    def test_a_missing_envelope_key_is_named(self):
        candidate = deepcopy(self.envelope)
        del candidate["payload"]
        self.put(candidate)
        line = self.rejected("document.invalid_wire")
        self.assertEqual((line["reason"], line["field"]), ("envelope_incomplete", "/payload"))

    def test_a_body_that_is_no_json_names_the_reader_reason(self):
        status, _, raw = self.put(f'{{"{CANARY}": '.encode())
        self.assertEqual(status, 400)
        self.assert_error_body(raw, 400, "document.invalid_wire")
        line = self.rejected("document.invalid_wire")
        self.assertEqual(line["reason"], "json")
        self.assertNotIn("field", line)
        self.assert_no_canary()

    def test_an_unreadable_if_match_is_logged_without_its_value(self):
        status, _, raw = self.put(self.envelope, {"If-Match": f'"{CANARY}"'})
        self.assertEqual(status, 400)
        self.assert_error_body(raw, 400, "document.invalid_revision")
        line = self.rejected("document.invalid_revision")
        self.assertEqual(line["reason"], "if_match_invalid")
        self.assert_no_canary()

    def test_a_revision_mismatch_names_both_revisions(self):
        revision = self.envelope["revision"]
        status, _, raw = self.put(self.envelope, {"If-Match": f'"{revision + 3}"'})
        self.assertEqual(status, 400)
        self.assert_error_body(raw, 400, "document.revision_mismatch")
        line = self.rejected("document.revision_mismatch")
        self.assertEqual(line["reason"], "revision_mismatch")
        self.assertEqual((line["expected"], line["actual"]), (revision + 3, revision))

    def test_a_conflict_names_the_revisions_once_before_the_409(self):
        stale = deepcopy(self.envelope)
        status, _, _ = self.put(self.envelope)
        self.assertEqual(status, 200)
        status, _, raw = self.put(stale)
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(raw)["error"]["code"], "document.revision_conflict")
        line = self.only("document.save_conflict")
        self.assertEqual(line["level"], "warning")
        self.assertEqual(line["document"], "manuscript")
        self.assertEqual(line["expected"], stale["revision"])
        self.assertIsInstance(line["actual"], int)
        self.assertNotEqual(line["actual"], line["expected"])
        self.assertEqual(line["request_id"], self.only("http.access")["request_id"])
        self.assertEqual(self.lines("document.save_rejected"), [])


if __name__ == "__main__":
    unittest.main()
