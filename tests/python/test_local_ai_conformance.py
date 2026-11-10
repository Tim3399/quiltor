"""The local-AI conformance suite (T-179): what a local inference server must answer.

One set of cases (`ServerCases`) runs against every server under test:
- the real MLX bridge (`BridgeConformanceTests`, always, no MLX needed),
- a running llama-server (`LlamaConformanceTests`, only when `QUILTOR_CONFORMANCE_LLAMA_URL`
  names one; otherwise it skips and says why. Nothing is downloaded or started here).

Case numbers follow the contract's table (local-ai-contract v1, section 5). A case is recorded
once, as one JSON line with its status and raw answer, when `QUILTOR_CONFORMANCE_ARTIFACT` is
set: that is how CI keeps the real answers of a pinned llama-server.

What only the bridge can be asked (a server that is still loading, a key, a body that lies about
its length, a generation that crashes) lives in `BridgeOnlyTests`.
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar
from unittest.mock import patch

from conformance_support import (
    ARTIFACT_VARIABLE,
    LLAMA_URL_VARIABLE,
    Answer,
    ServerUnderTest,
    fake_state,
    llama_server_from_env,
    load_bridge,
    start_bridge,
)

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}
CONTEXT_ERRORS = {"context_too_large", "exceed_context_size_error", "context_length_exceeded"}


if TYPE_CHECKING:
    # The mixins below are test cases once combined with unittest.TestCase; for the type
    # checker they already are, so their assert methods resolve.
    _Mixin = unittest.TestCase
else:
    _Mixin = object


def chat_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": "local",
        "messages": [{"role": "user", "content": "Hallo"}],
        "max_tokens": 64,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "answer", "strict": True, "schema": SCHEMA},
        },
    }
    body.update(overrides)
    return {key: value for key, value in body.items() if value is not None}


def assert_envelope(case: unittest.TestCase, answer: Answer) -> dict[str, Any]:
    """The error envelope of contract 3.1, returned for further checks."""
    body = answer.json()
    case.assertIsInstance(body, dict, answer.raw)
    case.assertEqual(set(body), {"error"}, answer.raw)
    error = body["error"]
    case.assertIsInstance(error, dict, answer.raw)
    case.assertIsInstance(error.get("message"), str, answer.raw)
    case.assertIsInstance(error.get("type"), str, answer.raw)
    case.assertIn("param", error, answer.raw)
    case.assertIsInstance(error["param"], (str, type(None)), answer.raw)
    case.assertIn("code", error, answer.raw)
    case.assertIsInstance(error["code"], (str, type(None)), f"code must be a string: {answer.raw}")
    for name in set(error) - {"message", "type", "param", "code"}:
        case.assertTrue(name.startswith("x_"), f"extra field {name!r} lacks the x_ prefix")
    return error


class ServerCases(_Mixin):
    """The cases every server must pass. A subclass supplies `server`."""

    server: ClassVar[ServerUnderTest]

    def call(self, case: str, method: str, path: str, body: Any = None) -> Answer:
        """One request, recorded under the case number."""
        answer = self.server.request(method, path, body)
        self.server.record(case, method, path, answer)
        return answer

    def test_c01_minimal_completion(self):
        answer = self.call("C01", "POST", "/v1/chat/completions", chat_body())
        self.assertEqual(answer.status, 200, answer.raw)
        body = answer.json()
        self.assertIsInstance(body["id"], str)
        self.assertTrue(body["id"])
        self.assertEqual(body["object"], "chat.completion")
        self.assertIsInstance(body["created"], int)
        self.assertIsInstance(body["model"], str)
        self.assertEqual(len(body["choices"]), 1)
        choice = body["choices"][0]
        self.assertEqual(choice["index"], 0)
        self.assertEqual(choice["message"]["role"], "assistant")
        self.assertIsInstance(choice["message"]["content"], str)
        self.assertEqual(choice["finish_reason"], "stop")
        usage = body["usage"]
        for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
            self.assertIsInstance(usage[name], int, name)

    def test_c02_missing_model_is_refused(self):
        answer = self.call("C02", "POST", "/v1/chat/completions", chat_body(model=None))
        self.assertEqual(answer.status, 400, answer.raw)

    def test_c03_an_unknown_role_is_refused(self):
        body = chat_body(messages=[{"role": "robot", "content": "Hallo"}])
        answer = self.call("C03", "POST", "/v1/chat/completions", body)
        self.assertEqual(answer.status, 400, answer.raw)

    def test_c17_a_cut_off_answer_says_length(self):
        answer = self.call("C17", "POST", "/v1/chat/completions", chat_body(max_tokens=1))
        self.assertEqual(answer.status, 200, answer.raw)
        self.assertEqual(answer.json()["choices"][0]["finish_reason"], "length")

    def test_c20_a_prompt_beyond_the_context_is_refused_as_such(self):
        long_prompt = "wort " * 30000
        body = chat_body(messages=[{"role": "user", "content": long_prompt}])
        answer = self.call("C20", "POST", "/v1/chat/completions", body)
        self.assertEqual(answer.status, 400, answer.raw)
        error = answer.json()["error"]
        self.assertTrue(
            {error.get("code"), error.get("type")} & CONTEXT_ERRORS,
            f"not a context error: {answer.raw}",
        )

    def test_c22_an_error_comes_in_the_contract_envelope(self):
        answer = self.call("C22", "POST", "/v1/chat/completions", chat_body(model=None))
        self.assertGreaterEqual(answer.status, 400, answer.raw)
        assert_envelope(self, answer)

    def test_c39_tokenize_when_offered(self):
        answer = self.call("C39", "POST", "/x/v1/tokenize", {"model": "local", "content": "a b"})
        if answer.status == 404:
            self.skipTest("/x/v1/tokenize is not offered by this server")
        self.assertEqual(answer.status, 200, answer.raw)
        self.assertIsInstance(answer.json()["count"], int)
        neither = self.server.request("POST", "/x/v1/tokenize", {"model": "local"})
        self.assertEqual(neither.status, 400, neither.raw)
        assert_envelope(self, neither)

    def test_c40_health_when_offered(self):
        answer = self.call("C40a", "GET", "/x/v1/health")
        if answer.status == 404:
            self.skipTest("/x/v1/health is not offered by this server")
        self.assertEqual(answer.status, 200, answer.raw)
        self.assertEqual(answer.json(), {"status": "ok", "contract": "lac-v1"})


class BridgeFixture(_Mixin):
    """The real bridge handler on a free port, with fakes in `STATE`."""

    bridge: ClassVar[Any]
    server: ClassVar[ServerUnderTest]

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.bridge = load_bridge()
        state = patch.dict(cls.bridge.STATE, fake_state(cls.bridge))
        state.start()
        cls.addClassCleanup(state.stop)
        http_server, url = start_bridge(cls.bridge)
        cls.addClassCleanup(http_server.server_close)
        cls.addClassCleanup(http_server.shutdown)
        cls.server = ServerUnderTest(kind="bridge", base_url=url)


class BridgeConformanceTests(BridgeFixture, ServerCases, unittest.TestCase):
    pass


class LlamaConformanceTests(ServerCases, unittest.TestCase):
    """The same cases against a running llama-server, when one is named."""

    @classmethod
    def setUpClass(cls) -> None:
        server = llama_server_from_env()
        if server is None:
            raise unittest.SkipTest(
                f"{LLAMA_URL_VARIABLE} is not set: no llama-server to ask "
                "(CI starts one; nothing is downloaded here)"
            )
        cls.server = server


class BridgeOnlyTests(BridgeFixture, unittest.TestCase):
    """What a test can only ask of the bridge, because it controls the bridge's state."""

    def post(self, body: Any, path: str = "/v1/chat/completions") -> Answer:
        return self.server.request("POST", path, body)

    def raw_request(self, head: str, body: bytes = b"") -> bytes:
        """A request line and headers sent as they are, for what a client library would not send."""
        host, port = self.server.base_url.removeprefix("http://").split(":")
        with socket.create_connection((host, int(port)), timeout=5) as connection:
            connection.sendall(head.encode() + b"\r\n\r\n" + body)
            chunks = []
            try:
                while chunk := connection.recv(4096):
                    chunks.append(chunk)
            except TimeoutError:
                pass
        return b"".join(chunks)

    # --- C01..C03 in detail ---------------------------------------------------------------

    def test_a_completion_echoes_the_model_and_names_itself(self):
        body = self.post(chat_body(model="my-model")).json()
        self.assertRegex(body["id"], r"^chatcmpl-[0-9a-f]{32}$")
        self.assertEqual(body["model"], "my-model")
        self.assertGreater(body["created"], 1_700_000_000)

    def test_two_completions_do_not_share_an_id(self):
        first = self.post(chat_body()).json()["id"]
        self.assertNotEqual(first, self.post(chat_body()).json()["id"])

    def test_a_missing_model_names_the_field(self):
        answer = self.post(chat_body(model=None))
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["type"], error["param"]),
            (400, "invalid_request", "invalid_request_error", "model"),
        )

    def test_an_unknown_role_names_the_message(self):
        answer = self.post(chat_body(messages=[{"role": "robot", "content": "x"}]))
        error = assert_envelope(self, answer)
        self.assertEqual((error["code"], error["param"]), ("invalid_request", "messages[0].role"))

    def test_no_messages_is_refused(self):
        for messages in ([], "hi", None):
            with self.subTest(messages=messages):
                answer = self.post(chat_body(messages=messages))
                error = assert_envelope(self, answer)
                self.assertEqual((answer.status, error["param"]), (400, "messages"))

    def test_a_body_that_is_not_json_or_not_an_object_is_refused_in_the_envelope(self):
        for raw in (b"not json", b"[1, 2]", b""):
            with self.subTest(raw=raw):
                reply = self.raw_request(
                    "POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n"
                    f"Content-Length: {len(raw)}\r\nConnection: close",
                    raw,
                )
                self.assertIn(b" 400 ", reply.split(b"\r\n")[0], reply)
                error = json.loads(reply.split(b"\r\n\r\n", 1)[1])["error"]
                self.assertEqual(error["code"], "invalid_request")

    # --- C17, C20 -------------------------------------------------------------------------

    def test_c20_in_detail_and_at_its_boundary(self):
        too_long = chat_body(messages=[{"role": "user", "content": "w " * 7001}])
        answer = self.post(too_long)
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["type"], error["param"]),
            (400, "context_too_large", "invalid_request_error", "messages"),
        )
        exactly = chat_body(messages=[{"role": "user", "content": "w " * 7000}])
        self.assertEqual(self.post(exactly).status, 200)

    def test_a_missing_schema_is_refused_with_its_path(self):
        answer = self.post(chat_body(response_format=None))
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["param"]),
            (400, "invalid_request", "response_format.json_schema.schema"),
        )

    def test_an_invalid_schema_is_refused_with_its_path(self):
        class Rejecting(self.bridge.STATE["LLMatcher"]):
            @staticmethod
            def validate_grammar(_grammar: Any) -> str:
                return "no such keyword"

        with patch.dict(self.bridge.STATE, {"LLMatcher": Rejecting}):
            self.bridge.GRAMMAR_CACHE.clear()
            answer = self.post(chat_body())
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["param"]),
            (400, "invalid_request", "response_format.json_schema.schema"),
        )
        self.assertIn("no such keyword", error["message"])

    # --- 401, 404, 500 --------------------------------------------------------------------

    def test_a_wrong_key_is_401_in_the_envelope_and_the_right_one_passes(self):
        with patch.dict(os.environ, {"QUILTOR_SIDECAR_KEY": "sekret"}):
            refused = self.post(chat_body())
            error = assert_envelope(self, refused)
            self.assertEqual(
                (refused.status, error["code"], error["type"]),
                (401, "invalid_api_key", "invalid_request_error"),
            )
            self.assertNotIn("sekret", refused.raw)
            keyed = ServerUnderTest(kind="bridge", base_url=self.server.base_url, api_key="sekret")
            self.assertEqual(keyed.request("POST", "/v1/chat/completions", chat_body()).status, 200)

    def test_an_unknown_route_is_404_in_the_envelope(self):
        for answer in (
            self.server.request("GET", "/nope"),
            self.server.request("POST", "/nope", {}),
        ):
            error = assert_envelope(self, answer)
            self.assertEqual((answer.status, error["code"]), (404, "not_found"))

    def test_a_crash_is_500_with_a_fixed_text_and_the_detail_stays_in_the_log(self):
        crashing = fake_state(self.bridge, fail_with="secret detail of the crash")
        with patch.dict(self.bridge.STATE, crashing), patch("builtins.print") as log:
            answer = self.post(chat_body())
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["type"], error["message"]),
            (500, "internal_error", "api_error", "internal server error"),
        )
        self.assertNotIn("secret detail", answer.raw)
        self.assertIn("secret detail of the crash", " ".join(str(call) for call in log.mock_calls))

    # --- Content-Length -------------------------------------------------------------------

    def test_a_content_length_that_is_not_a_length_is_answered_not_dropped(self):
        for value, status in (("-1", 400), ("abc", 400), ("99999999999", 413)):
            with self.subTest(content_length=value):
                reply = self.raw_request(
                    "POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n"
                    f"Content-Length: {value}\r\nConnection: close"
                )
                status_line = reply.split(b"\r\n")[0]
                self.assertIn(f" {status} ".encode(), status_line, f"no answer: {reply!r}")
                error = json.loads(reply.split(b"\r\n\r\n", 1)[1])["error"]
                self.assertEqual(error["type"], "invalid_request_error")
        # The bridge still answers afterwards.
        self.assertEqual(self.post(chat_body()).status, 200)

    # --- C40 ------------------------------------------------------------------------------

    def test_c40_ready_is_the_same_on_both_routes(self):
        bodies = [self.server.request("GET", path) for path in ("/x/v1/health", "/health")]
        self.assertEqual([answer.status for answer in bodies], [200, 200])
        self.assertEqual(bodies[0].raw, bodies[1].raw)
        self.assertEqual(bodies[0].json(), {"status": "ok", "contract": "lac-v1"})

    def test_c40_loading_is_503_with_x_status_loading(self):
        with patch.dict(self.bridge.STATE, {"ready": False, "error": None}):
            for path in ("/x/v1/health", "/health"):
                answer = self.server.request("GET", path)
                error = assert_envelope(self, answer)
                self.assertEqual(
                    (answer.status, error["code"], error["type"], error["x_status"]),
                    (503, "unavailable", "service_unavailable_error", "loading"),
                    path,
                )
            posted = self.post(chat_body())
            self.assertEqual(
                (posted.status, assert_envelope(self, posted)["x_status"]), (503, "loading")
            )

    def test_c40_a_failed_load_is_503_with_x_status_unavailable_and_no_detail(self):
        with patch.dict(self.bridge.STATE, {"ready": False, "error": "weights file is corrupt"}):
            answer = self.server.request("GET", "/x/v1/health")
        error = assert_envelope(self, answer)
        self.assertEqual(
            (answer.status, error["code"], error["x_status"]), (503, "unavailable", "unavailable")
        )
        self.assertNotIn("corrupt", answer.raw)


class RecordingTests(BridgeFixture, unittest.TestCase):
    """The llama mode, run end to end against the bridge: it needs no download to be checked."""

    def test_the_llama_mode_records_one_line_per_case_and_skips_without_a_url(self):
        with tempfile.TemporaryDirectory() as folder:
            artifact = Path(folder, "answers.jsonl")
            variables = {LLAMA_URL_VARIABLE: self.server.base_url, ARTIFACT_VARIABLE: str(artifact)}
            with patch.dict(os.environ, variables):
                result = self.run_llama_mode()
            self.assertTrue(result.wasSuccessful(), result)
            lines = [json.loads(line) for line in artifact.read_text("utf-8").splitlines()]
        cases = [line["case"] for line in lines]
        self.assertEqual(
            sorted(cases), ["C01", "C02", "C03", "C17", "C20", "C22", "C39", "C40a"], cases
        )
        self.assertEqual({line["kind"] for line in lines}, {"llama"})
        by_case = {line["case"]: line for line in lines}
        self.assertEqual(by_case["C01"]["status"], 200)
        self.assertEqual(json.loads(by_case["C01"]["raw"])["choices"][0]["finish_reason"], "stop")
        self.assertEqual(by_case["C20"]["status"], 400)
        self.assertEqual(by_case["C40a"]["status"], 200)

    def test_without_the_variable_nothing_is_asked_and_nothing_is_written(self):
        with patch.dict(os.environ):
            os.environ.pop(LLAMA_URL_VARIABLE, None)
            result = self.run_llama_mode()
        self.assertEqual(result.testsRun, 0)
        self.assertEqual(len(result.skipped), 1)
        self.assertIn(LLAMA_URL_VARIABLE, result.skipped[0][1])

    @staticmethod
    def run_llama_mode() -> unittest.TestResult:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(LlamaConformanceTests)
        return unittest.TextTestRunner(stream=StringIO(), verbosity=0).run(suite)


if __name__ == "__main__":
    unittest.main()
