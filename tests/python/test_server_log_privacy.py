"""T-71 P6: nothing an author wrote, and no secret a request carried, reaches the server log.

Every path that writes a line is driven with canary values -- one per category of the
plan's deny list (T-71 plan, section 3.1) -- and then the whole output is searched: the
stderr stream and the log file, byte for byte, not the parsed fields. A field rule that
masks a value as "<invalid>" would hide a leak from a test that reads fields, so most
canaries are shaped to pass those rules: letters and digits only.

Allowed on purpose (plan 3): the log file's own path in `logging.configured`, and the id
of a world that failed to resolve in `world.resolve_failed` -- it is a hex id the server
checked, and nothing else may carry it before the world is resolved.
"""

from __future__ import annotations

import contextlib
import dataclasses
import errno
import http.client
import io
import json
import os
import sqlite3
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from quiltor.delivery.http import routes as api_routes
from quiltor.infrastructure.observability import StdlibStructuredLogger
from quiltor.infrastructure.observability import schema as log_schema
from tests.python.test_server_logging import _LiveServer

# One canary per category of plan 3.1, plus the request-borne values the brief names.
# Letters and digits only, so no field rule can turn them into "<invalid>" and hide them.
CANARIES = {
    "prose": "CNRYprose7f3a",  # 1: manuscript text
    "chapter_title": "CNRYtitle7f3a",  # 1: a title
    "world_name": "CNRYworld7f3a",  # 1: a world's name
    "storyboard": "CNRYboard7f3a",  # 1: storyboard content
    "body_key": "CNRYbodykey7f3a",  # 2: a key the sender chose
    "body_raw": "CNRYbodyraw7f3a",  # 2: a body that is no JSON
    "if_match": "CNRYifmatch7f3a",  # 2: a header the route reads
    "query_token": "CNRYtoken7f3a",  # 3: ?token=
    "query_render": "CNRYrender7f3a",  # 3: ?renderToken=
    "query_key": "CNRYqkey7f3a",  # 3: an unknown parameter's name
    "query_value": "CNRYqvalue7f3a",  # 3: an unknown parameter's value
    "query_world": "CNRYqworld7f3a",  # 3: ?world= that is no world id
    "path": "CNRYpath7f3a",  # 3: an unknown route's path
    "cookie_session": "CNRYcookie7f3a",  # 4: the session cookie
    "cookie_login": "CNRYlogin7f3a",  # 4: the login-state cookie
    "bearer": "CNRYbearer7f3a",  # 5: Authorization
    "oidc_token": "CNRYoidc7f3a",  # 5: tokens a session holds
    "api_key": "CNRYapikey7f3a",  # 6: QUILTOR_BACKUP_TOKEN
    "email": "CNRYemail7f3a",  # 7: the session's email
    "name": "CNRYname7f3a",  # 7: the session's name
    "file_path": "CNRYfile7f3a",  # 8: a path that carries a world's name
    "exception": "CNRYexc7f3a",  # an exception's own text
    "request_id": "CNRYrid7f3a",  # an implausible X-Request-Id
    "origin": "cnryorigin7f3a",  # a foreign Origin header
}
# A well-formed id of a world nobody has: the one value allowed in world.resolve_failed.
UNRESOLVED_WORLD = "c0ffee" * 5 + "ab"
ALLOWED_IN = {UNRESOLVED_WORLD: {"world.resolve_failed"}}

# Every event of plan 2.2 must have been written by the scenarios at least once, or a
# clean log would only prove that the path was never taken.
REQUIRED_EVENTS = frozenset(log_schema.EVENTS)


class _PrivacyServer(_LiveServer):
    def setUp(self):
        logs = tempfile.TemporaryDirectory()
        self.addCleanup(logs.cleanup)
        self.log_file = Path(logs.name) / "quiltor-server.log"
        self.stderr = io.StringIO()
        environment = patch.dict(
            os.environ,
            {
                "QUILTOR_LOG_FILE": str(self.log_file),
                "QUILTOR_LOG_LEVEL": "DEBUG",
                "QUILTOR_BACKUP_TOKEN": CANARIES["api_key"],
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        # The start-up line (logging.configured) goes to whatever stderr is then.
        with patch.object(sys, "stderr", self.stderr):
            super().setUp()
        # _LiveServer quietened the logger into a buffer of its own; point it back at
        # both outputs this test reads. The file keeps what start-up wrote to it.
        StdlibStructuredLogger(stream=self.stderr, level="DEBUG", file=self.log_file)

    # ---------- reading the output ----------

    def output(self) -> str:
        for handler in __import__("logging").getLogger("quiltor").handlers:
            handler.flush()
        return self.stderr.getvalue() + "\n" + self.log_file.read_text(encoding="utf-8")

    def assert_clean(self) -> None:
        text = self.output()
        hits = [name for name, value in CANARIES.items() if value in text]
        self.assertEqual(hits, [], f"canaries in the log: {hits}\n{self._lines_with(hits)}")
        for line in text.splitlines():
            for value, events in ALLOWED_IN.items():
                if value in line:
                    event = json.loads(line).get("event")
                    self.assertIn(event, events, f"{value} outside {events}: {line}")
        for line in self.parsed():
            if line.get("event") == "logging.configured" and "file" in line:
                self.assertEqual(line["file"], str(self.log_file))

    def _lines_with(self, names) -> str:
        values = [CANARIES[name] for name in names]
        return "\n".join(
            line for line in self.output().splitlines() if any(v in line for v in values)
        )

    def parsed(self) -> list[dict]:
        lines = []
        for raw in self.output().splitlines():
            if raw.strip():
                lines.append(json.loads(raw))
        return lines

    def events(self) -> set[str]:
        return {line["event"] for line in self.parsed()}

    # ---------- the scenarios ----------

    def manuscript_path(self, world: str | None = None) -> str:
        return f"/api/manuscript?world={world or self.world_id}"

    def envelope(self) -> dict:
        status, _, raw = self.request("GET", self.manuscript_path())
        self.assertEqual(status, 200)
        return json.loads(raw)

    def scenario_content(self):
        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": CANARIES["world_name"], "backupUrl": ""}
        )
        self.assertEqual(status, 200)
        named_world = json.loads(raw)["world"]["id"]
        self.request("GET", f"/api/worlds?{CANARIES['query_key']}=1")
        envelope = self.envelope()
        chapter = envelope["payload"]["chapters"][0]
        chapter["title"] = CANARIES["chapter_title"]
        chapter["body"] = f"Der Morgen lag still. {CANARIES['prose']}"
        status, _, _ = self.request("PUT", self.manuscript_path(), envelope)
        self.assertEqual(status, 200)
        self.request("GET", self.manuscript_path(named_world))
        status, _, raw = self.request("GET", f"/api/storyboards?world={self.world_id}")
        boards = json.loads(raw)
        boards["payload"]["nodes"] = [
            {"id": CANARIES["storyboard"], "label": CANARIES["storyboard"]}
        ]
        self.request("PUT", f"/api/storyboards?world={self.world_id}", boards)

    def scenario_rejected_saves(self):
        envelope = self.envelope()
        foreign_key = deepcopy(envelope)
        foreign_key[CANARIES["body_key"]] = CANARIES["prose"]
        self.assertEqual(self.request("PUT", self.manuscript_path(), foreign_key)[0], 400)
        payload_key = deepcopy(envelope)
        payload_key["payload"][CANARIES["body_key"]] = [CANARIES["prose"]]
        payload_key["payload"]["hiddenElements"] = [{CANARIES["body_key"]: 1}]
        self.assertEqual(self.request("PUT", self.manuscript_path(), payload_key)[0], 400)
        raw_body = f'{{"{CANARIES["body_raw"]}": '.encode()
        self.assertEqual(self.request("PUT", self.manuscript_path(), raw_body)[0], 400)
        bad_match = {"If-Match": f'"{CANARIES["if_match"]}"'}
        self.assertEqual(self.request("PUT", self.manuscript_path(), envelope, bad_match)[0], 400)
        mismatch = {"If-Match": f'"{envelope["revision"] + 7}"'}
        self.assertEqual(self.request("PUT", self.manuscript_path(), envelope, mismatch)[0], 400)
        stale = deepcopy(envelope)
        self.assertEqual(self.request("PUT", self.manuscript_path(), envelope)[0], 200)
        self.assertEqual(self.request("PUT", self.manuscript_path(), stale)[0], 409)

    def scenario_query_and_headers(self):
        query = (
            f"&token={CANARIES['query_token']}&renderToken={CANARIES['query_render']}"
            f"&{CANARIES['query_key']}={CANARIES['query_value']}"
        )
        headers = {
            "Cookie": (
                f"quiltor_session={CANARIES['cookie_session']}; "
                f"quiltor_login_state={CANARIES['cookie_login']}"
            ),
            "Authorization": f"Bearer {CANARIES['bearer']}",
        }
        self.request("GET", self.manuscript_path() + query, headers=headers)
        self.request("GET", f"/api/{CANARIES['path']}?x={CANARIES['query_value']}")
        self.request("GET", f"/{CANARIES['path']}.js?{CANARIES['query_key']}=1")
        self.request(
            "GET", "/api/version", headers={"Origin": f"https://{CANARIES['origin']}.example"}
        )
        for request_id in (
            CANARIES["request_id"] + "x" * 64,
            f"{CANARIES['request_id']} spaced",
            CANARIES["request_id"][:5],
        ):
            self.request("GET", "/api/version", headers={"X-Request-Id": request_id})

    def scenario_sessions(self):
        identity = self.application.identity
        original = identity.resolve

        def with_personal_data(handler):
            session = original(handler)
            if session is None:
                return None
            return dataclasses.replace(
                session,
                email=f"{CANARIES['email']}@example.org",
                name=CANARIES["name"],
                access_token=CANARIES["oidc_token"],
                refresh_token=CANARIES["oidc_token"],
                id_token=CANARIES["oidc_token"],
            )

        with patch.object(identity, "resolve", side_effect=with_personal_data):
            self.request("GET", self.manuscript_path())
            self.request("GET", self.manuscript_path(UNRESOLVED_WORLD))
        cookie = {"Cookie": f"quiltor_session={CANARIES['cookie_session']}"}
        with patch.object(identity, "resolve", return_value=None):
            self.assertEqual(self.request("GET", self.manuscript_path(), headers=cookie)[0], 401)

    def scenario_worlds(self):
        self.assertEqual(self.request("GET", self.manuscript_path(CANARIES["query_world"]))[0], 400)
        self.assertEqual(self.request("GET", self.manuscript_path(UNRESOLVED_WORLD))[0], 404)
        with patch.object(
            type(self.application),
            "resolve_world",
            side_effect=PermissionError(errno.EACCES, CANARIES["exception"], CANARIES["file_path"]),
        ):
            self.assertEqual(self.request("GET", self.manuscript_path())[0], 403)
        self.request(
            "POST", "/api/assistant/jobs", {"worldId": CANARIES["query_world"], "kind": "x"}
        )

    def _failing_route(self, path: str, error_or_route):
        route = error_or_route
        if isinstance(error_or_route, BaseException):

            def route(handler, request, app):
                raise error_or_route

        return patch.dict(api_routes.GET, {path: api_routes.Registration(route)})

    def scenario_unhandled(self):
        with self._failing_route("/api/test-key", KeyError(CANARIES["exception"])):
            self.assertEqual(self.request("GET", "/api/test-key")[0], 500)
        chained = RuntimeError("plain")
        chained.__cause__ = ValueError(CANARIES["exception"])
        with self._failing_route("/api/test-chain", chained):
            self.request("GET", "/api/test-chain")

        def fails_late(handler, request, app):
            handler.send_response(200)
            handler.send_header("Content-Length", "10")
            handler.end_headers()
            raise RuntimeError(CANARIES["exception"])

        logged = self.fresh()
        with self._failing_route("/api/test-late", fails_late):
            with contextlib.suppress(http.client.HTTPException, OSError):
                self.request("GET", "/api/test-late")
            self.wait_logged(lambda ids: len(ids) > logged)
        try:
            raise ValueError(CANARIES["exception"])
        except ValueError:
            with patch.object(sys, "stderr", io.StringIO()):
                self.httpd.handle_error(cast(Any, None), ("127.0.0.1", 0))

    def scenario_storage(self):
        disk = OSError(errno.ENOSPC, CANARIES["exception"], CANARIES["file_path"])
        broken = OSError(errno.EIO, CANARIES["exception"], CANARIES["file_path"])
        quiet = sqlite3.OperationalError("database or disk is full")
        quiet.sqlite_errorcode = sqlite3.SQLITE_FULL
        quiet.sqlite_errorname = "SQLITE_FULL"
        for index, error in enumerate((disk, broken, quiet)):
            path = f"/api/test-storage-{index}"
            with self._failing_route(path, error):
                self.assertIn(self.request("GET", path)[0], {500, 503})

    def scenario_sqlite_text(self):
        full = sqlite3.OperationalError(f"{CANARIES['exception']} {CANARIES['file_path']}.db")
        full.sqlite_errorcode = sqlite3.SQLITE_FULL
        full.sqlite_errorname = "SQLITE_FULL"
        with self._failing_route("/api/test-sqlite-text", full):
            self.assertIn(self.request("GET", "/api/test-sqlite-text")[0], {500, 503})

    def scenario_operator_only(self):
        # A hosted server refuses an install; its line names the route, not the body.
        self.application.operation_profile = "hosted"
        try:
            status, _, _ = self.request(
                "POST", "/api/writing-assistance/grammar/install", {"x": CANARIES["prose"]}
            )
            self.assertEqual(status, 403)
        finally:
            self.application.operation_profile = "local"

    SCENARIOS = (
        "scenario_content",
        "scenario_rejected_saves",
        "scenario_query_and_headers",
        "scenario_sessions",
        "scenario_worlds",
        "scenario_unhandled",
        "scenario_storage",
        "scenario_operator_only",
    )


class ServerLogPrivacyTests(_PrivacyServer):
    def test_content_and_world_names_stay_out_of_the_log(self):
        self.scenario_content()
        self.assert_clean()

    def test_refused_saves_name_no_key_body_or_header_value(self):
        self.scenario_rejected_saves()
        self.assertTrue({"document.save_rejected", "document.save_conflict"} <= self.events())
        self.assert_clean()

    def test_queries_cookies_tokens_and_foreign_ids_stay_out_of_the_log(self):
        self.scenario_query_and_headers()
        self.assert_clean()

    def test_a_session_contributes_its_sub_and_nothing_else(self):
        self.scenario_sessions()
        self.assert_clean()

    def test_an_unresolved_world_is_named_only_where_it_failed(self):
        self.scenario_worlds()
        self.assertIn("world.resolve_failed", self.events())
        self.assert_clean()

    def test_an_unhandled_failure_logs_frames_but_not_its_text(self):
        self.scenario_unhandled()
        self.assertIn("http.unhandled", self.events())
        self.assert_clean()

    def test_a_storage_failure_logs_codes_but_no_path_or_text(self):
        self.scenario_storage()
        self.assertIn("storage.failed", self.events())
        self.assert_clean()

    # Found by this suite (D-T-71-P6): sqlite puts paths and quoted values into its
    # message, so http.unhandled speaks only the error name.
    def test_a_sqlite_failure_logs_its_code_but_not_its_text(self):
        self.scenario_sqlite_text()
        self.assert_clean()
        unhandled = [line for line in self.parsed() if line["event"] == "http.unhandled"]
        # Once on stderr, once in the file.
        self.assertEqual([line["message"] for line in unhandled], ["SQLITE_FULL"] * 2)
        for line in unhandled:
            self.assertTrue(line["traceback"].endswith("OperationalError: SQLITE_FULL"))

    def test_every_event_is_written_and_none_carries_a_canary(self):
        for name in self.SCENARIOS:
            with self.subTest(name):
                getattr(self, name)()
        self.assertEqual(REQUIRED_EVENTS - self.events(), set())
        self.assertIn("logging.configured", self.log_file.read_text(encoding="utf-8"))
        for line in self.parsed():
            allowed = log_schema.EVENTS.get(line["event"])
            if allowed is not None:
                self.assertLessEqual(
                    set(line) - {"event", "level", "timestamp"}, allowed, line["event"]
                )
        self.assert_clean()
