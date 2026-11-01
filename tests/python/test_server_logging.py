"""The server's structured log: one access line per request, an error line per
failure, and a request id that ties both to the answer the user saw.

The lines are read from the process-wide `quiltor` logger through a handler of
this test's own, the way an operator reads stderr. Every request runs against a
real server.Server, so the hooks are pinned where they sit and not on a stand-in.
"""

import ast
import contextlib
import errno
import http.client
import io
import json
import logging
import os
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock, patch

from quiltor.application.documents.ports import RevisionConflict
from quiltor.application.errors import (
    ApplicationForbidden,
    ApplicationNotFound,
    ApplicationUnavailable,
)
from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http import routes as api_routes
from quiltor.hosts.web import server
from quiltor.infrastructure.observability import StdlibStructuredLogger
from quiltor.infrastructure.observability import schema as log_schema
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.request_timeout import REQUEST_TIMEOUT

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "quiltor"
GENERATED_ID = re.compile(r"[a-z2-7]{16}")
UNKNOWN_WORLD = "0" * 32
CANARY = "CANARY-7f3a"


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.lines: list[dict] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(
            {
                "event": record.getMessage(),
                "level": record.levelname.lower(),
                **getattr(record, "structured_fields", {}),
            }
        )


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


class _LiveServer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        environment = patch.dict(
            os.environ, {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": ""}
        )
        environment.start()
        self.addCleanup(environment.stop)
        with patch(
            "quiltor.bootstrap.web.build_assistant_services",
            return_value=AssistantServices(MagicMock(), MagicMock()),
        ):
            self.application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=_directories(root),
            )
        self.application.prepare()
        # The logger is the process-wide `quiltor` one, so configuring it again
        # reaches the application's instance too: quiet stderr for the suite, the
        # capture below is what the tests read.
        StdlibStructuredLogger(stream=io.StringIO())
        self.addCleanup(StdlibStructuredLogger)
        self.capture = _Capture()
        quiltor_logger = logging.getLogger("quiltor")
        quiltor_logger.addHandler(self.capture)
        self.addCleanup(quiltor_logger.removeHandler, self.capture)

        # The access line is written after the answer has gone out -- its status and
        # size are only known then -- so a client can read a response before its line
        # exists. Each request below waits until the server has finished logging the
        # very id its answer carries; no sleeping, no guessing.
        self._logged_ids: list[str] = []
        self._logged = threading.Condition()
        original = server.Handler._log_request

        def traced(handler, context, *args, **kwargs):
            try:
                original(handler, context, *args, **kwargs)
            finally:
                with self._logged:
                    self._logged_ids.append(context.request_id)
                    self._logged.notify_all()

        tracing = patch.object(server.Handler, "_log_request", traced)
        tracing.start()
        self.addCleanup(tracing.stop)

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.httpd.shutdown()
            self.httpd.server_close()
            thread.join(timeout=5)
            self.application.close()
            self.temp.cleanup()

        self.addCleanup(stop)
        self.world_id = self._create_world()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        hdrs = dict(headers or {})
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=hdrs)
        response = conn.getresponse()
        raw = response.read()
        result = response.status, {k.lower(): v for k, v in response.getheaders()}, raw
        conn.close()
        request_id = result[1].get("x-request-id")
        if request_id:
            self.wait_logged(lambda ids: request_id in ids)
        return result

    def wait_logged(self, condition) -> None:
        with self._logged:
            reached = self._logged.wait_for(
                lambda: condition(self._logged_ids), timeout=REQUEST_TIMEOUT
            )
        self.assertTrue(reached, "the server never finished logging the request")

    def _create_world(self) -> str:
        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": "Testwelt", "backupUrl": ""}
        )
        self.assertEqual(status, 200)
        return json.loads(raw)["world"]["id"]

    def lines(self, event: str) -> list[dict]:
        return [line for line in self.capture.lines if line["event"] == event]

    def only(self, event: str) -> dict:
        found = self.lines(event)
        self.assertEqual(len(found), 1, f"{event}: {found}")
        return found[0]

    def fresh(self) -> int:
        """Forget the lines so far; returns how many requests had been logged."""
        self.capture.lines.clear()
        with self._logged:
            return len(self._logged_ids)


class AccessLineTests(_LiveServer):
    def test_a_get_writes_one_access_line_under_the_id_of_its_answer(self):
        self.fresh()
        status, headers, _ = self.request("GET", f"/api/manuscript?world={self.world_id}")

        self.assertEqual(status, 200)
        line = self.only("http.access")
        self.assertEqual(line["level"], "info")
        self.assertEqual(line["method"], "GET")
        self.assertEqual(line["route"], "/api/manuscript")
        self.assertEqual(line["status"], 200)
        self.assertEqual(line["world_id"], self.world_id)
        self.assertEqual(line["sub"], "quiltor-internal:local-owner")
        self.assertGreater(line["bytes_out"], 0)
        self.assertEqual(line["bytes_in"], 0)
        self.assertIsInstance(line["duration_ms"], int)
        self.assertRegex(line["request_id"], GENERATED_ID)
        self.assertEqual(headers["x-request-id"], line["request_id"])
        self.assertEqual(self.lines("http.error"), [])

    def test_a_put_counts_the_bytes_it_received(self):
        status, _, raw = self.request("GET", f"/api/manuscript?world={self.world_id}")
        envelope = json.loads(raw)
        self.fresh()
        body = json.dumps(envelope).encode("utf-8")
        status, _, _ = self.request(
            "PUT",
            f"/api/manuscript?world={self.world_id}",
            body,
            {"If-Match": str(envelope.get("revision", ""))},
        )
        line = self.only("http.access")
        self.assertEqual(line["method"], "PUT")
        self.assertEqual(line["route"], "/api/manuscript")
        self.assertEqual(line["bytes_in"], len(body))
        self.assertEqual(line["status"], status)

    def test_a_request_id_from_a_proxy_is_kept(self):
        supplied = "3f2b8c1e-9a4d-4f6b-8e2a-7c5d1b0a9e33"
        self.fresh()
        _, headers, _ = self.request("GET", "/api/version", headers={"X-Request-Id": supplied})
        self.assertEqual(headers["x-request-id"], supplied)
        line = self.only("http.access")
        self.assertEqual(line["request_id"], supplied)
        self.assertNotIn("request_id_rejected", line)

    def test_an_implausible_request_id_is_replaced_and_never_written(self):
        for supplied in ("short", CANARY + "/" + "x" * 70, "has space-" + CANARY):
            with self.subTest(supplied=supplied):
                self.fresh()
                _, headers, _ = self.request(
                    "GET", "/api/version", headers={"X-Request-Id": supplied}
                )
                self.assertRegex(headers["x-request-id"], GENERATED_ID)
                line = self.only("http.access")
                self.assertTrue(line["request_id_rejected"])
                self.assertEqual(line["request_id"], headers["x-request-id"])
                self.assertNotIn(supplied, repr(self.capture.lines))

    def test_every_kind_of_answer_carries_the_request_id(self):
        token = cast(Any, self.application.identity).token  # the local identity's
        cases = {
            "json": ("GET", "/api/version", 200),
            "redirect": ("GET", f"/?token={token}", 302),
            "static file or its 404": ("GET", "/no-such-asset.js", None),
        }
        for name, (method, path, expected_status) in cases.items():
            with self.subTest(name):
                self.fresh()
                status, headers, _ = self.request(method, path)
                if expected_status is not None:
                    self.assertEqual(status, expected_status)
                self.assertRegex(headers.get("x-request-id", ""), GENERATED_ID)
                # The redirect and the asset are client_asset requests, whose access
                # line is DEBUG; the JSON answer's line shows the id is the logged one.
                if name == "json":
                    self.assertEqual(
                        self.only("http.access")["request_id"], headers["x-request-id"]
                    )

    def test_static_assets_log_their_access_only_at_debug(self):
        self.fresh()
        self.request("GET", "/no-such-asset.js")
        self.assertEqual(self.lines("http.access"), [])


class QuietRouteTests(_LiveServer):
    def _with_level(self, level: str):
        StdlibStructuredLogger(stream=io.StringIO(), level=level)

    def test_polled_routes_are_debug_and_their_errors_are_not(self):
        for route in sorted(log_schema.QUIET_ROUTES):
            with self.subTest(route=route):
                self._with_level("INFO")
                self.fresh()
                self.request("GET", f"{route}?world={self.world_id}")
                self.assertEqual(self.lines("http.access"), [])

                self._with_level("DEBUG")
                self.fresh()
                self.request("GET", f"{route}?world={self.world_id}")
                line = self.only("http.access")
                self.assertEqual(line["level"], "debug")
                self.assertEqual(line["route"], route)

                self._with_level("INFO")
                self.fresh()
                status, _, _ = self.request("GET", f"{route}?world=not-a-world")
                self.assertEqual(status, 400)
                self.assertEqual(self.only("http.error")["route"], route)


class ErrorLineTests(_LiveServer):
    def _error(self, status: int, code: str) -> dict:
        line = self.only("http.error")
        self.assertEqual(line["status"], status)
        self.assertEqual(line["code"], code)
        self.assertEqual(line["level"], "error" if status >= 500 else "warning")
        self.assertEqual(self.only("http.access")["request_id"], line["request_id"])
        return line

    def test_the_error_body_names_the_request_id_and_nothing_else_changes(self):
        self.fresh()
        status, headers, raw = self.request("GET", "/api/no-such-route")
        self.assertEqual(status, 404)
        body = json.loads(raw)
        request_id = body["error"].pop("requestId")
        self.assertEqual(request_id, headers["x-request-id"])
        self.assertEqual(body, http_errors.for_status(404, code="route_not_found").payload())
        self.assertEqual(self._error(404, "route_not_found")["route"], "unmatched_api")

    def test_a_success_body_carries_no_request_id(self):
        _, _, raw = self.request("GET", f"/api/manuscript?world={self.world_id}")
        self.assertNotIn(b"requestId", raw)

    def test_a_request_without_a_session_is_a_logged_401(self):
        self.fresh()
        with patch.object(self.application.identity, "resolve", return_value=None):
            status, _, raw = self.request("GET", f"/api/manuscript?world={self.world_id}")
        self.assertEqual(status, 401)
        line = self._error(401, "auth.unauthenticated")
        self.assertEqual(json.loads(raw)["error"]["requestId"], line["request_id"])
        self.assertNotIn("sub", line)
        self.assertNotIn("world_id", line)

    def test_the_foreign_origin_403_is_logged_with_its_code(self):
        self.fresh()
        status, _, raw = self.request(
            "GET", "/api/version", headers={"Origin": "https://evil.example"}
        )
        self.assertEqual(status, 403)
        line = self._error(403, "request.untrusted_origin")
        self.assertEqual(json.loads(raw)["error"]["requestId"], line["request_id"])

    def test_a_coded_refusal_outside_the_api_is_logged_with_its_code(self):
        """A page path logs http.error only when its answer carries a code; the
        foreign-origin 403 on POST / is the one such answer."""
        self.fresh()
        status, _, _ = self.request("POST", "/", b"", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        # Its access line is DEBUG, like every page path; the error line is not.
        line = self.only("http.error")
        self.assertEqual(line["status"], 403)
        self.assertEqual(line["code"], "request.untrusted_origin")
        self.assertEqual(line["level"], "warning")
        self.assertEqual(line["route"], "client_asset")

    def test_an_error_claimed_with_a_success_status_is_logged_as_the_500_it_becomes(self):
        def claims_success(handler, request, app):
            handler.send_json({"ok": False}, 200)

        self.fresh()
        with patch.dict(
            api_routes.GET, {"/api/test-claims-success": api_routes.Registration(claims_success)}
        ):
            status, _, raw = self.request("GET", "/api/test-claims-success")
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(raw)["error"]["code"], "application.invalid_error_status")
        self._error(500, "application.invalid_error_status")

    def test_an_invalid_document_is_logged_with_its_code(self):
        self.fresh()
        status, _, raw = self.request(
            "PUT", f"/api/manuscript?world={self.world_id}", {"wire": "broken"}
        )
        self.assertEqual(status, 400)
        code = json.loads(raw)["error"]["code"]
        self.assertEqual(code, "document.invalid_wire")
        line = self._error(400, code)
        self.assertEqual(line["world_id"], self.world_id)


class WorldResolutionTests(_LiveServer):
    def test_each_refusal_names_its_reason(self):
        cases = (
            ("invalid", "not-a-world", 400, None),
            ("not_found", UNKNOWN_WORLD, 404, UNKNOWN_WORLD),
        )
        for reason, world, status, logged_world in cases:
            with self.subTest(reason=reason):
                self.fresh()
                answered, _, _ = self.request("GET", f"/api/manuscript?world={world}")
                self.assertEqual(answered, status)
                line = self.only("world.resolve_failed")
                self.assertEqual(line["reason"], reason)
                self.assertEqual(line.get("world_id"), logged_world)
                self.assertEqual(line.get("world_id_invalid"), None if logged_world else True)
                self.assertNotIn(world if logged_world is None else "\0", repr(self.capture.lines))

        with self.subTest(reason="forbidden"):
            self.fresh()
            with patch.object(
                type(self.application), "resolve_world", side_effect=PermissionError("not yours")
            ):
                answered, _, _ = self.request("GET", f"/api/manuscript?world={self.world_id}")
            self.assertEqual(answered, 403)
            self.assertEqual(self.only("world.resolve_failed")["reason"], "forbidden")

    def test_a_world_the_request_only_names_is_not_its_world(self):
        self.fresh()
        status, _, _ = self.request("GET", f"/api/manuscript?world={UNKNOWN_WORLD}")
        self.assertEqual(status, 404)
        self.assertNotIn("world_id", self.only("http.error"))
        self.assertNotIn("world_id", self.only("http.access"))

    def test_a_world_from_the_body_is_the_one_logged(self):
        self.fresh()
        self.request(
            "POST",
            f"/api/assistant/jobs?world={UNKNOWN_WORLD}",
            {"worldId": self.world_id, "kind": "unknown"},
        )
        self.assertEqual(self.lines("world.resolve_failed"), [])
        self.assertEqual(self.only("http.access")["world_id"], self.world_id)


class UnhandledTests(_LiveServer):
    def _expected_failure(self, raised: Exception, status: int, code: str) -> None:
        def refuses(handler, request, app):
            raise raised

        self.fresh()
        with patch.dict(api_routes.GET, {"/api/test-refuses": api_routes.Registration(refuses)}):
            answered, _, raw = self.request("GET", "/api/test-refuses")
        self.assertEqual(answered, status)
        self.assertEqual(self.lines("http.unhandled"), [])
        line = self.only("http.error")
        self.assertEqual(line["status"], status)
        self.assertEqual(line["code"], code)
        self.assertEqual(line["level"], "warning")
        self.assertEqual(json.loads(raw)["error"]["requestId"], line["request_id"])

    def test_a_revision_conflict_is_an_answer_not_an_unhandled_failure(self):
        self._expected_failure(
            RevisionConflict("manuscript", 0, 1), 409, "document.revision_conflict"
        )

    def test_a_route_refusing_with_not_found_or_forbidden_is_not_unhandled(self):
        cases = (
            (ApplicationNotFound("missing"), 404, "application.not_found"),
            (ApplicationForbidden("not yours"), 403, "application.forbidden"),
        )
        for raised, status, code in cases:
            with self.subTest(code=code):
                self._expected_failure(raised, status, code)

    def test_an_unavailable_application_keeps_its_traceback_and_cause(self):
        """A 5xx application error wraps a failure; it stays http.unhandled."""

        def unavailable(handler, request, app):
            try:
                raise OSError("disk gone")
            except OSError as cause:
                raise ApplicationUnavailable(CANARY) from cause

        self.fresh()
        with patch.dict(api_routes.GET, {"/api/test-down": api_routes.Registration(unavailable)}):
            status, _, _ = self.request("GET", "/api/test-down")
        self.assertEqual(status, 503)
        line = self.only("http.unhandled")
        self.assertEqual(line["error_type"], "ApplicationUnavailable")
        self.assertEqual(line["message"], "application.unavailable")
        self.assertIn("in unavailable", line["traceback"])
        self.assertIn("OSError: disk gone", line["traceback"])
        self.assertTrue(
            line["traceback"].endswith("ApplicationUnavailable: application.unavailable")
        )
        self.assertNotIn(CANARY, repr(self.capture.lines))

    def test_a_failing_route_is_logged_with_frames_but_not_its_text(self):
        def fails(handler, request, app):
            raise KeyError(CANARY)

        self.fresh()
        with patch.dict(api_routes.GET, {"/api/test-fails": api_routes.Registration(fails)}):
            status, _, raw = self.request("GET", "/api/test-fails")
        self.assertEqual(status, 500)
        line = self.only("http.unhandled")
        self.assertEqual(line["level"], "error")
        self.assertEqual(line["error_type"], "KeyError")
        self.assertEqual(line["route"], "/api/test-fails")
        self.assertIn("in fails", line["traceback"])
        self.assertTrue(line["traceback"].endswith("KeyError"))
        self.assertNotIn(CANARY, repr(self.capture.lines))
        self.assertEqual(json.loads(raw)["error"]["requestId"], line["request_id"])
        self.assertEqual(self.only("http.error")["code"], "application.internal_error")

    def test_a_failure_after_the_answer_began_is_logged_once(self):
        def fails_late(handler, request, app):
            handler.send_response(200)
            handler.send_header("Content-Length", "10")
            handler.end_headers()
            raise RuntimeError(CANARY)

        logged_before = self.fresh()
        with patch.dict(
            api_routes.GET, {"/api/test-fails-late": api_routes.Registration(fails_late)}
        ):
            # The body never comes; how the client notices depends on the platform.
            with contextlib.suppress(http.client.HTTPException, OSError):
                self.request("GET", "/api/test-fails-late")
            # The client may give up before it sees the id, so wait for the count.
            self.wait_logged(lambda ids: len(ids) > logged_before)
        unhandled = self.only("http.unhandled")
        self.assertEqual(unhandled["status"], 200)
        self.assertNotIn(CANARY, repr(self.capture.lines))

    def test_handle_error_writes_a_structured_line_instead_of_a_plain_traceback(self):
        self.fresh()
        stderr = io.StringIO()
        try:
            raise ValueError(CANARY)
        except ValueError:
            with patch.object(sys, "stderr", stderr):
                self.httpd.handle_error(cast(Any, None), ("127.0.0.1", 0))
        line = self.only("http.unhandled")
        self.assertEqual(line["error_type"], "ValueError")
        self.assertIn("Traceback", line["traceback"])
        self.assertNotIn(CANARY, repr(self.capture.lines))
        self.assertEqual(stderr.getvalue(), "")


class StorageFailureTests(_LiveServer):
    """A storage failure answers with a stable code and logs the raw one behind it."""

    def fail_with(self, error: Exception):
        def fails(handler, request, app):
            raise error

        self.fresh()
        with patch.dict(api_routes.GET, {"/api/test-storage": api_routes.Registration(fails)}):
            status, _, raw = self.request("GET", "/api/test-storage")
        return status, json.loads(raw)

    def sqlite_error(self, code: int, name: str) -> sqlite3.OperationalError:
        error = sqlite3.OperationalError(f"{CANARY} /private/{CANARY}.db")
        error.sqlite_errorcode = code
        error.sqlite_errorname = name
        return error

    def assert_body_unchanged(self, body: dict, expected: http_errors.HttpError, line: dict):
        wanted = expected.payload()
        wanted["error"]["requestId"] = line["request_id"]
        self.assertEqual(body, wanted)

    def test_each_sqlite_failure_is_logged_with_its_raw_code(self):
        cases = [
            (sqlite3.SQLITE_FULL, "SQLITE_FULL", "storage.full"),
            (sqlite3.SQLITE_READONLY, "SQLITE_READONLY", "storage.read_only"),
            (sqlite3.SQLITE_BUSY, "SQLITE_BUSY", "storage.locked"),
            (sqlite3.SQLITE_READONLY_DBMOVED, "SQLITE_READONLY_DBMOVED", "storage.read_only"),
        ]
        for raw_code, name, code in cases:
            with self.subTest(name):
                status, body = self.fail_with(self.sqlite_error(raw_code, name))
                line = self.only("storage.failed")
                self.assertEqual(status, 503)
                self.assertEqual(line["level"], "error")
                self.assertEqual(line["code"], code)
                self.assertEqual(line["sqlite_code"], raw_code)
                self.assertEqual(line["sqlite_name"], name)
                self.assertNotIn("errno", line)
                self.assert_body_unchanged(body, http_errors.for_status(503, code=code), line)
                self.assertNotIn("sqlite", json.dumps(body))

    def test_a_full_disk_is_logged_with_its_errno(self):
        status, body = self.fail_with(OSError(errno.ENOSPC, f"{CANARY}", f"/private/{CANARY}"))
        line = self.only("storage.failed")
        self.assertEqual(status, 503)
        self.assertEqual(line["code"], "storage.full")
        self.assertEqual(line["errno"], errno.ENOSPC)
        self.assertEqual(line["errno_name"], "ENOSPC")
        self.assertNotIn("sqlite_code", line)
        self.assert_body_unchanged(body, http_errors.for_status(503, code="storage.full"), line)

    def test_an_unclassified_sqlite_failure_is_a_500_with_its_code(self):
        status, body = self.fail_with(self.sqlite_error(sqlite3.SQLITE_CORRUPT, "SQLITE_CORRUPT"))
        line = self.only("storage.failed")
        self.assertEqual(status, 500)
        self.assertEqual((line["code"], line["sqlite_code"]), ("application.internal_error", 11))
        self.assert_body_unchanged(body, http_errors.for_status(500), line)

    def test_the_line_carries_neither_a_path_nor_the_exception_text(self):
        self.fail_with(self.sqlite_error(sqlite3.SQLITE_FULL, "SQLITE_FULL"))
        self.fail_with(OSError(errno.ENOSPC, CANARY, f"/private/{CANARY}"))
        self.assertNotIn(CANARY, repr(self.capture.lines))
        self.assertNotIn("/private", repr(self.capture.lines))
        allowed = log_schema.EVENTS["storage.failed"] | {"event", "level"}
        for line in self.lines("storage.failed"):
            self.assertLessEqual(line.keys(), allowed)

    def test_failures_that_are_not_storage_failures_write_no_line(self):
        for error in (
            PermissionError(errno.EACCES, "denied"),
            FileNotFoundError(errno.ENOENT, "x"),
        ):
            with self.subTest(type(error).__name__):
                self.fail_with(error)
                self.assertEqual(self.lines("storage.failed"), [])

    def test_the_log_fields_never_reach_the_response_payload(self):
        error = http_errors.from_exception(self.sqlite_error(sqlite3.SQLITE_FULL, "SQLITE_FULL"))
        self.assertEqual(error.log_fields["sqlite_code"], sqlite3.SQLITE_FULL)
        self.assertEqual(
            error.payload(), http_errors.for_status(503, code="storage.full").payload()
        )
        self.assertEqual(error, http_errors.for_status(503, code="storage.full"))


class LoggerTests(unittest.TestCase):
    def setUp(self):
        self.stream = io.StringIO()
        self.logger = StdlibStructuredLogger("quiltor.test.schema", self.stream)

    def written(self) -> dict:
        return json.loads(self.stream.getvalue().splitlines()[-1])

    def test_a_registered_event_writes_only_its_fields(self):
        self.logger.event("info", "http.access", route="/api/version", body=CANARY)
        line = self.written()
        self.assertEqual(line["route"], "/api/version")
        self.assertEqual(line["dropped_fields"], ["body"])
        self.assertNotIn(CANARY, self.stream.getvalue())

    def test_a_value_breaking_its_rule_is_replaced(self):
        self.logger.event("info", "http.access", world_id=CANARY, sub="a b", status="200")
        line = self.written()
        self.assertEqual(line["world_id"], log_schema.INVALID)
        self.assertEqual(line["sub"], log_schema.INVALID)
        self.assertEqual(line["status"], log_schema.INVALID)
        self.logger.event("warning", "http.error", code="Not A Code")
        self.assertEqual(self.written()["code"], "invalid_code")

    def test_legacy_events_keep_their_lines(self):
        self.logger.event("warning", "place_map.upload_rejected", error_code="x.y")
        line = self.written()
        self.assertEqual(line["error_code"], "x.y")
        self.assertNotIn("dropped_fields", line)

    def test_a_line_inside_a_request_carries_its_id(self):
        context = log_schema.RequestContext("abcdefgh12", "GET", "/api/version")
        with log_schema.request_scope(context):
            self.logger.event("warning", "persistence.operation_failed", operation="save")
        self.assertEqual(self.written()["request_id"], "abcdefgh12")
        self.assertIsNone(log_schema.current_request.get())

    def test_without_configuration_there_is_one_stderr_stream_at_info(self):
        name = "quiltor.test.default"
        logger = logging.getLogger(name)
        StdlibStructuredLogger(name)
        StdlibStructuredLogger(name)
        handlers = logger.handlers
        self.assertEqual(len(handlers), 1)
        handler = handlers[0]
        assert type(handler) is logging.StreamHandler
        self.assertIs(handler.stream, sys.stderr)
        self.assertEqual(logger.level, logging.INFO)

    def test_the_world_id_rule_is_the_catalogues_own(self):
        from quiltor.infrastructure.persistence.sqlite import world_catalog

        self.assertIs(log_schema.WORLD_ID_RE, world_catalog.WORLD_ID_RE)

    def test_request_ids(self):
        self.assertRegex(log_schema.new_request_id(), GENERATED_ID)
        self.assertEqual(log_schema.accept_request_id("a" * 32), ("a" * 32, False))
        for refused in ("a" * 7, "a" * 65, "abc\ndefgh", "abcdefgh!"):
            accepted, rejected = log_schema.accept_request_id(refused)
            self.assertTrue(rejected, refused)
            self.assertRegex(accepted, GENERATED_ID)


class EventRegistryTests(unittest.TestCase):
    def test_every_event_literal_is_registered(self):
        known = log_schema.EVENTS.keys() | log_schema.LEGACY_EVENTS
        unregistered = []
        for path in SOURCE.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "event"
                    and len(node.args) >= 2
                ):
                    continue
                name = node.args[1]
                if (
                    isinstance(name, ast.Constant)
                    and isinstance(name.value, str)
                    and name.value not in known
                ):
                    relative = path.relative_to(ROOT).as_posix()
                    unregistered.append(f"{relative}:{node.lineno}: {name.value}")
        self.assertEqual(unregistered, [], "register these in observability/schema.py")


if __name__ == "__main__":
    unittest.main()
