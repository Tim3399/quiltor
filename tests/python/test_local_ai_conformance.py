"""The local-AI conformance suite (T-179): what a local inference server must answer.

One set of cases (`ServerCases`) runs against every server under test:
- the real MLX bridge (`BridgeConformanceTests`, always, no MLX needed),
- a running llama-server (`LlamaConformanceTests`, only when `QUILTOR_CONFORMANCE_LLAMA_URL`
  names one; otherwise it skips and says why. Nothing is downloaded or started here).

Case numbers follow the contract's table (local-ai-contract v1, section 5). A case is recorded
once, as one JSON line with its status and raw answer, when `QUILTOR_CONFORMANCE_ARTIFACT` is
set: that is how CI keeps the real answers of a pinned llama-server.

Client mode (`ClientCheckerTests`, cases C16-C24, C36, C37) turns the question round: a mock
server misbehaves and the client in `shared/contract.py` must raise the class the contract
names and not use the content. C21 (plausibility), C34 (model identity) and C15 (the schema lint,
part 3) are not asked here.

What only the bridge can be asked (a server that is still loading, a key, a body that lies about
its length, a generation that crashes) lives in `BridgeOnlyTests`.
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, ClassVar, cast
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

from quiltor.infrastructure.inference.shared.contract import (
    InferenceHTTPError,
    count_tokens,
    invoke_chat,
    normalise_error,
    refuses_json_schema,
)
from quiltor.modules.assistant.jobs import classify_assistant_error
from quiltor.modules.assistant.ports import (
    IncompleteInferenceResponse,
    InferenceContextTooLargeError,
    InferenceValidationError,
)
from quiltor.modules.assistant.runtime import AssistantRuntime

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


# --- Client mode: the checker in shared/contract.py against a server that misbehaves ----------

KEY = "sk-test-0123456789abcdefghijklmnopqrstuvwxyz"
PARSABLE = json.dumps({"answer": "ok"})
USAGE = {"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17}


def completion(
    content: str = PARSABLE,
    finish_reason: str | None = "stop",
    *,
    usage: Any = USAGE,
    choices: int = 1,
    **message: Any,
) -> dict[str, Any]:
    choice: dict[str, Any] = {
        "index": 0,
        "message": {"role": "assistant", "content": content, **message},
    }
    if finish_reason is not None:
        choice["finish_reason"] = finish_reason
    body: dict[str, Any] = {"id": "chatcmpl-1", "model": "local", "choices": [choice] * choices}
    if usage is not ABSENT:
        body["usage"] = usage
    return body


ABSENT = object()


class _Mock(BaseHTTPRequestHandler):
    """A server that answers one scripted reply to every request and counts them."""

    reply: ClassVar[tuple[int, Any]] = (200, {})
    # Replies handed out one by one before `reply` takes over.
    queue: ClassVar[list[tuple[int, Any]]] = []
    calls: ClassVar[list[dict[str, Any]]] = []

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        type(self).calls.append(json.loads(raw))
        status, body = type(self).queue.pop(0) if type(self).queue else type(self).reply
        data = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ClientCheckerTests(unittest.TestCase):
    """invoke_chat and count_tokens as the contract's client (cases C16-C24, C36, C37).

    The mock answers whatever the case needs; the client must raise the class the contract names
    and must not use the content of an answer it cannot trust.
    """

    def setUp(self) -> None:
        self.mock = type("Mock", (_Mock,), {"calls": [], "queue": []})
        server = ThreadingHTTPServer(("127.0.0.1", 0), self.mock)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.url = f"http://127.0.0.1:{server.server_address[1]}"

    def answer(self, status: int, body: Any) -> None:
        self.mock.reply = (status, body)

    def ask(self, **options: Any) -> dict[str, Any]:
        return invoke_chat(self.url, {"messages": []}, **options)

    # --- C16: the content must be what the schema call promised -----------------------------

    def test_c16_content_that_is_not_json_is_not_used(self):
        self.answer(200, completion("not json at all"))
        with self.assertRaises(InferenceValidationError):
            self.ask()
        self.answer(200, completion('["a list, not an object"]'))
        with self.assertRaises(InferenceValidationError):
            self.ask(include_metadata=True)

    # --- C17: length, always ----------------------------------------------------------------

    def test_c17_length_is_incomplete_even_when_the_content_parses(self):
        self.answer(200, completion(PARSABLE, "length"))
        with self.assertRaises(IncompleteInferenceResponse) as caught:
            self.ask()
        self.assertEqual(caught.exception.finish_reason, "length")
        self.assertEqual(caught.exception.raw_content, PARSABLE)

    def test_c17_a_cut_off_fragment_is_incomplete_too(self):
        self.answer(200, completion('{"answer": "ab', "length"))
        with self.assertRaises(IncompleteInferenceResponse):
            self.ask()

    def _runtime(self) -> AssistantRuntime:
        engine = SimpleNamespace(
            identity=self.url,
            invoke=lambda payload: invoke_chat(
                self.url, payload, include_metadata=True, strict_local=True
            ),
        )
        # _invoke_with_growth only reaches the engine; the other collaborators are not touched.
        return AssistantRuntime(
            Path("."),
            Path("."),
            cast(Any, engine),
            progress=cast(Any, None),
            read_tools=cast(Any, None),
            token_cache=cast(Any, None),
        )

    def test_c17_the_growth_retry_asks_again_with_more_room(self):
        self.mock.queue = [(200, completion(PARSABLE, "length")), (200, completion())]
        result = self._runtime()._invoke_with_growth({"messages": [], "max_tokens": 100}, 1000)
        self.assertEqual(result["answer"], "ok")
        self.assertEqual([call["max_tokens"] for call in self.mock.calls], [100, 200])

    def test_c17_f10_with_the_room_used_up_a_parsable_length_answer_is_refused(self):
        """F10 (a), strict: `length` means the server cut the answer off. When no larger limit
        fits, the content is not used even though it would pass the schema."""
        self.answer(200, completion(PARSABLE, "length"))
        runtime = self._runtime()
        prompt_tokens = 8192 - 256 - 50  # a room of 50 tokens, the request already asks for 100
        with self.assertRaises(InferenceValidationError):
            runtime._invoke_with_growth({"messages": [], "max_tokens": 100}, prompt_tokens)
        self.assertEqual(len(self.mock.calls), 1)

    # --- C18, C19: what else a finish_reason or a content can be ----------------------------

    def test_c18_a_local_finish_reason_other_than_stop_or_length_is_an_error(self):
        for reason in ("content_filter", "error", "tool_calls", "something_new", None):
            with self.subTest(finish_reason=reason):
                self.answer(200, completion(PARSABLE, reason))
                with self.assertRaises(InferenceValidationError):
                    self.ask(strict_local=True)

    def test_c18_an_external_provider_may_leave_finish_reason_out_or_spell_it_its_own_way(self):
        # Missing or unknown counts as complete; only "length" proves the answer was cut off.
        for reason in (None, "content_filter", "tool_calls", "something_new"):
            with self.subTest(finish_reason=reason):
                self.answer(200, completion(PARSABLE, reason))
                self.assertEqual(self.ask()["answer"], "ok")
                meta = self.ask(include_metadata=True)["_runtime"]
                self.assertEqual(meta["finishReason"], "stop")

    def test_c18_length_is_incomplete_on_both_paths(self):
        for strict in (True, False):
            with self.subTest(strict_local=strict):
                self.answer(200, completion(PARSABLE, "length"))
                with self.assertRaises(IncompleteInferenceResponse):
                    self.ask(strict_local=strict)

    def test_c19_an_empty_content_or_a_refusal_is_an_error(self):
        self.answer(200, completion(""))
        with self.assertRaises(InferenceValidationError):
            self.ask()
        self.answer(200, completion(PARSABLE, refusal="I cannot help with that."))
        with self.assertRaises(InferenceValidationError):
            self.ask()

    # --- C20: the context error, however the server names it --------------------------------

    def test_c20_a_context_error_is_a_context_error_whoever_says_it(self):
        bodies = {
            "llama-server": {
                "error": {
                    "code": 400,
                    "message": "the request exceeds the available context size",
                    "type": "exceed_context_size_error",
                    "n_prompt_tokens": 9000,
                    "n_ctx": 8192,
                }
            },
            "contract": {
                "error": {
                    "message": "prompt too long",
                    "type": "invalid_request_error",
                    "param": "messages",
                    "code": "context_too_large",
                }
            },
            "openai": {
                "error": {
                    "message": "This model's maximum context length is 8192 tokens.",
                    "type": "invalid_request_error",
                    "param": "messages",
                    "code": "context_length_exceeded",
                }
            },
        }
        for name, body in bodies.items():
            with self.subTest(server=name):
                self.answer(400, body)
                with self.assertRaises(InferenceContextTooLargeError) as caught:
                    self.ask()
                self.assertEqual(classify_assistant_error(caught.exception), "context_too_large")

    def test_c20_the_same_words_under_another_status_are_not_a_context_error(self):
        self.answer(500, {"error": {"type": "exceed_context_size_error", "message": "x"}})
        with self.assertRaises(InferenceHTTPError):
            self.ask()

    # --- C22, C23, C24: the envelope, normalised --------------------------------------------

    def test_c22_a_llama_style_envelope_is_read_into_the_contracts_terms(self):
        self.answer(
            400,
            {"error": {"code": 400, "message": "bad", "type": "invalid_request_error"}},
        )
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        error = caught.exception
        self.assertEqual(error.status, 400)
        self.assertIsNone(error.error_code)  # N1: an integer code is no code
        self.assertEqual(error.upstream_code, "400")
        self.assertEqual(error.error_type, "invalid_request_error")
        self.assertIsNone(error.param)

    def test_c23_an_error_inside_a_200_is_an_error_and_its_content_is_not_used(self):
        body = {"error": {"code": 502, "message": "upstream failed"}, **completion()}
        self.answer(200, body)
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(caught.exception.upstream_code, "502")  # N8

    def test_c24_a_groq_style_envelope_gets_null_param_and_code(self):
        self.answer(400, {"error": {"message": "bad request", "type": "invalid_request_error"}})
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertIsNone(caught.exception.param)
        self.assertIsNone(caught.exception.error_code)
        self.assertIsNone(caught.exception.upstream_code)
        self.assertEqual(caught.exception.error_type, "invalid_request_error")

    def test_an_answer_that_is_no_envelope_has_no_code_and_a_type_from_its_status(self):
        for status, body, expected in (
            (503, "Service Unavailable", "service_unavailable_error"),
            (400, {"error": "just a string"}, "invalid_request_error"),
            (500, "<html>", "api_error"),
            (429, {"detail": "slow down"}, "rate_limit_error"),
        ):
            with self.subTest(status=status):
                self.answer(status, body)
                with self.assertRaises(InferenceHTTPError) as caught:
                    self.ask()
                self.assertEqual(caught.exception.error_type, expected)
                self.assertIsNone(caught.exception.error_code)

    def test_the_tokenizer_error_is_read_the_same_way(self):
        self.answer(400, {"error": {"code": 400, "type": "exceed_context_size_error"}})
        with self.assertRaises(InferenceContextTooLargeError):
            count_tokens(self.url, "text")

    # --- C36, C37 ---------------------------------------------------------------------------

    def test_c36_zero_or_two_choices_are_an_error(self):
        for count in (0, 2):
            with self.subTest(choices=count):
                self.answer(200, completion(choices=count))
                with self.assertRaises(InferenceValidationError):
                    self.ask()

    def test_c37_a_local_answer_without_usage_is_an_error(self):
        for usage in (ABSENT, None, {}, {"prompt_tokens": 1}, "many"):
            with self.subTest(usage=usage):
                self.answer(200, completion(usage=usage))
                with self.assertRaises(InferenceValidationError):
                    self.ask(strict_local=True)

    def test_c37_an_external_provider_may_leave_usage_out(self):
        self.answer(200, completion(usage=ABSENT))
        self.assertEqual(self.ask()["answer"], "ok")
        self.assertEqual(self.ask(include_metadata=True)["_runtime"]["promptTokens"], None)

    def test_a_complete_answer_passes_and_reports_its_usage(self):
        self.answer(200, completion())
        result = self.ask(include_metadata=True, strict_local=True)
        self.assertEqual(result["answer"], "ok")
        self.assertEqual(result["_runtime"]["totalTokens"], 17)
        self.assertEqual(result["_runtime"]["finishReason"], "stop")

    # --- The key and the envelope ------------------------------------------------------------

    def test_a_key_echoed_inside_the_envelope_is_replaced_before_it_is_read(self):
        body = {"error": {"message": f"bad key {KEY}", "type": KEY, "param": KEY, "code": KEY}}
        self.answer(401, body)
        with self.assertRaises(InferenceHTTPError) as caught:
            invoke_chat(self.url, {"messages": []}, api_key=KEY)
        error = caught.exception
        everything = " ".join(
            str(part)
            for part in (error, error.detail, error.error_type, error.error_code, error.param)
        )
        self.assertNotIn(KEY, everything)
        self.assertEqual(error.error_type, "***")

    def test_what_an_envelope_carries_is_cut_short(self):
        self.answer(400, {"error": {"type": "t" * 5000, "param": "p" * 5000}})
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertLessEqual(len(caught.exception.error_type or ""), 100)
        self.assertLessEqual(len(caught.exception.param or ""), 100)

    # --- refuses_json_schema reads the envelope ----------------------------------------------

    def test_a_refusal_naming_response_format_is_a_json_schema_refusal(self):
        self.answer(400, {"error": {"message": "unsupported", "param": "response_format"}})
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertTrue(refuses_json_schema(caught.exception))

    def test_an_error_naming_another_parameter_is_not_one_even_if_the_text_mentions_it(self):
        self.answer(
            400,
            {
                "error": {
                    "message": "max_tokens too large, response_format is fine",
                    "param": "max_tokens",
                }
            },
        )
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertFalse(refuses_json_schema(caught.exception))

    def test_without_an_envelope_the_markers_in_the_text_still_decide(self):
        self.answer(
            404,
            {"error": {"message": "No endpoints found for the requested parameters", "code": 404}},
        )
        with self.assertRaises(InferenceHTTPError) as caught:
            self.ask()
        self.assertTrue(refuses_json_schema(caught.exception))

    # --- normalise_error on its own -----------------------------------------------------------

    def test_normalise_error_covers_the_listed_deviations(self):
        cases = {
            "N1 integer code": (
                {"error": {"code": 400, "message": "m"}},
                (None, "400", None),
            ),
            "N2 own types": (
                {"error": {"code": 503, "type": "unavailable_error"}},
                ("unavailable", "unavailable_error", None),
            ),
            "N2 not supported": (
                {"error": {"code": 501, "type": "not_supported_error"}},
                ("unsupported_parameter", "not_supported_error", None),
            ),
            "N8 openrouter": (
                {"error": {"code": 402, "message": "m", "metadata": {"raw": "x"}}},
                (None, "402", None),
            ),
            "N12 groq": ({"error": {"message": "m", "type": "t"}}, (None, None, None)),
            "N15 openai": (
                {"error": {"code": "context_length_exceeded", "param": "messages"}},
                ("context_too_large", "context_length_exceeded", "messages"),
            ),
            "contract code kept": (
                {"error": {"code": "invalid_request", "param": "model"}},
                ("invalid_request", None, "model"),
            ),
        }
        for name, (body, (code, upstream, param)) in cases.items():
            with self.subTest(name):
                error = normalise_error(400, body)
                self.assertEqual(
                    (error.code, error.upstream_code, error.param), (code, upstream, param)
                )
        self.assertEqual(
            normalise_error(400, json.dumps({"error": {"code": 400}})).upstream_code, "400"
        )
        self.assertEqual(normalise_error(400, b"\xff not json").code, None)


if __name__ == "__main__":
    unittest.main()
