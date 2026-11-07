"""An external, OpenAI-compatible inference endpoint with an API key (T-58 P5).

The operator may point Quiltor at OpenAI, OpenRouter or Anthropic's OpenAI-compatible endpoint.
The key must only ever travel to that endpoint: never in plain http across a network, never
along a redirect, and never into a status, a log line, an error text or a reply.
"""

from __future__ import annotations

import contextlib
import io
import json
import logging
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar, cast
from unittest.mock import patch

from test_assistant_runtime import FIGURES
from test_assistant_runtime import _Progress as RuntimeProgress
from test_assistant_runtime import _ReadTools as RuntimeReadTools

from quiltor.infrastructure.inference import engine as engine_module
from quiltor.infrastructure.inference.endpoint import InferenceEndpoint, resolve_endpoint
from quiltor.infrastructure.inference.shared.contract import json_object_fallback
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant.runtime import AssistantRuntime

KEY = "sk-test-0123456789abcdefghijklmnopqrstuvwxyz"
SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}
CHAT_PAYLOAD = {
    "model": "local",
    "messages": [
        {"role": "system", "content": "Du bist hilfsbereit."},
        {"role": "user", "content": "Hallo"},
    ],
    "response_format": {
        "type": "json_schema",
        "json_schema": {"name": "quiltor_reply", "strict": True, "schema": SCHEMA},
    },
}


# --- canned answers in the style of three providers ------------------------------------------

MODELS = {
    "openai": {"object": "list", "data": [{"id": "gpt-4o-mini", "object": "model"}]},
    "openrouter": {"data": [{"id": "openai/gpt-4o-mini", "name": "OpenAI: GPT-4o-mini"}]},
    "anthropic": {
        "data": [{"id": "claude-sonnet-4-5", "type": "model", "display_name": "Claude"}],
        "has_more": False,
    },
}


def chat_answer(provider: str, content: str) -> dict[str, Any]:
    answer: dict[str, Any] = {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "model": {"openai": "gpt-4o-mini", "openrouter": "openai/gpt-4o-mini"}.get(
            provider, "claude-sonnet-4-5"
        ),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17},
    }
    if provider == "openrouter":
        answer["provider"] = "OpenAI"
    return answer


JSON_SCHEMA_REFUSALS = {
    "openai": (
        400,
        {
            "error": {
                "message": "Invalid parameter: 'response_format' of type 'json_schema' is not "
                "supported with this model.",
                "type": "invalid_request_error",
                "param": "response_format",
                "code": None,
            }
        },
    ),
    "openrouter": (
        404,
        {
            "error": {
                "message": "No endpoints found that can handle the requested parameters.",
                "code": 404,
            }
        },
    ),
}


class _Endpoint(BaseHTTPRequestHandler):
    """A fake provider. `script` maps a path to the answers it gives, in order."""

    script: ClassVar[dict[str, list[tuple[int, Any, dict[str, str]]]]] = {}
    seen: ClassVar[list[dict[str, Any]]] = []

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _handle(self, body: Any) -> None:
        type(self).seen.append(
            {
                "method": self.command,
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "body": body,
            }
        )
        answers = type(self).script.get(self.path) or [(404, {"error": "not found"}, {})]
        status, payload, headers = answers.pop(0) if len(answers) > 1 else answers[0]
        data = (payload if isinstance(payload, str) else json.dumps(payload)).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._handle(None)

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self._handle(json.loads(raw) if raw else None)


def _serve(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


class _Capabilities:
    def is_available(self, _feature):
        return True

    def evaluate(self, _feature):
        class Available:
            available = True
            reasons: ClassVar[list[str]] = []

        return Available()


# --- configuration -------------------------------------------------------------------------


class ResolveEndpointTests(unittest.TestCase):
    def test_without_a_key_the_endpoint_is_exactly_what_it_was(self):
        self.assertEqual(
            resolve_endpoint({}),
            InferenceEndpoint(url="http://127.0.0.1:11435", api_key="", external=False),
        )
        self.assertEqual(
            resolve_endpoint({"QUILTOR_AI_URL": "http://192.168.1.20:8080/"}).url,
            "http://192.168.1.20:8080",
        )

    def test_a_key_with_plain_http_to_another_host_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "must be HTTPS"):
            resolve_endpoint({"QUILTOR_AI_URL": "http://api.example.com", "QUILTOR_AI_KEY": KEY})

    def test_a_key_with_https_or_loopback_http_is_accepted(self):
        for url in ("https://api.openai.com", "http://127.0.0.1:4000", "http://localhost:4000"):
            endpoint = resolve_endpoint({"QUILTOR_AI_URL": url, "QUILTOR_AI_KEY": KEY})
            self.assertTrue(endpoint.external, url)
            self.assertEqual(endpoint.api_key, KEY)

    def test_userinfo_query_and_fragment_are_refused(self):
        for url, message in (
            ("https://user:secret@api.example.com", "user information"),
            ("https://api.example.com?x=1", "query or fragment"),
            ("https://api.example.com#v1", "query or fragment"),
        ):
            with self.assertRaisesRegex(RuntimeError, message):
                resolve_endpoint({"QUILTOR_AI_URL": url, "QUILTOR_AI_KEY": KEY})

    def test_both_key_sources_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            key_file = Path(folder) / "key"
            key_file.write_text(KEY)
            with self.assertRaisesRegex(RuntimeError, "not both"):
                resolve_endpoint(
                    {
                        "QUILTOR_AI_URL": "https://api.openai.com",
                        "QUILTOR_AI_KEY": KEY,
                        "QUILTOR_AI_KEY_FILE": str(key_file),
                    }
                )

    def test_the_key_file_is_read_and_an_empty_one_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            key_file = Path(folder) / "key"
            key_file.write_text(f"  {KEY}\n")
            endpoint = resolve_endpoint(
                {"QUILTOR_AI_URL": "https://api.openai.com", "QUILTOR_AI_KEY_FILE": str(key_file)}
            )
            self.assertEqual(endpoint.api_key, KEY)
            key_file.write_text("  \n")
            with self.assertRaisesRegex(RuntimeError, "empty"):
                resolve_endpoint(
                    {
                        "QUILTOR_AI_URL": "https://api.openai.com",
                        "QUILTOR_AI_KEY_FILE": str(key_file),
                    }
                )

    def test_a_key_without_a_url_is_a_start_error(self):
        with self.assertRaisesRegex(RuntimeError, "QUILTOR_AI_KEY requires QUILTOR_AI_URL"):
            resolve_endpoint({"QUILTOR_AI_KEY": KEY})
        with tempfile.TemporaryDirectory() as folder:
            key_file = Path(folder) / "key"
            key_file.write_text(KEY)
            with self.assertRaisesRegex(RuntimeError, "QUILTOR_AI_KEY requires QUILTOR_AI_URL"):
                resolve_endpoint({"QUILTOR_AI_KEY_FILE": str(key_file)})

    def test_a_key_with_control_characters_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "control characters"):
            resolve_endpoint({"QUILTOR_AI_URL": "https://api.openai.com", "QUILTOR_AI_KEY": "a\nb"})

    def test_no_error_message_carries_the_key(self):
        for environ in (
            {"QUILTOR_AI_KEY": KEY},
            {"QUILTOR_AI_URL": "http://api.example.com", "QUILTOR_AI_KEY": KEY},
            {"QUILTOR_AI_URL": f"https://x:{KEY}@api.example.com", "QUILTOR_AI_KEY": KEY},
        ):
            with self.assertRaises(RuntimeError) as caught:
                resolve_endpoint(environ)
            self.assertNotIn(KEY, str(caught.exception))

    def test_the_key_is_not_in_repr(self):
        endpoint = resolve_endpoint(
            {"QUILTOR_AI_URL": "https://api.openai.com", "QUILTOR_AI_KEY": KEY}
        )
        self.assertNotIn(KEY, repr(endpoint))
        self.assertNotIn(KEY, str(endpoint))

    def test_the_model_name_comes_from_its_own_variable(self):
        self.assertEqual(resolve_endpoint({}).model_name, "local")
        self.assertEqual(
            resolve_endpoint({"QUILTOR_AI_MODEL_NAME": "gpt-4o-mini"}).model_name, "gpt-4o-mini"
        )
        with self.assertRaisesRegex(RuntimeError, "QUILTOR_AI_MODEL_NAME"):
            resolve_endpoint({"QUILTOR_AI_MODEL_NAME": " "})


# --- the engine in external mode -----------------------------------------------------------


class _ExternalEngineCase(unittest.TestCase):
    provider = "openai"

    def setUp(self):
        _Endpoint.seen = []
        _Endpoint.script = {"/v1/models": [(200, MODELS[self.provider], {})]}
        self.server, self.url = _serve(_Endpoint)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        env = patch.dict(
            os.environ,
            {
                "QUILTOR_AI_URL": self.url,
                "QUILTOR_AI_KEY": KEY,
                "QUILTOR_AI_MODEL_NAME": "gpt-4o-mini",
            },
        )
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("QUILTOR_AI_KEY_FILE", None)
        os.environ.pop("QUILTOR_AI_JSON_MODE", None)

    def engine(self) -> engine_module.LocalInferenceEngine:
        with patch.object(engine_module.select, "start_runtime") as start_runtime:
            engine = engine_module.LocalInferenceEngine(
                Path("."), Path("."), cast(Any, _Capabilities())
            )
            engine.reload()
        self.assertFalse(start_runtime.called, "an external endpoint starts no sidecar")
        return engine

    def answer_chat(self, *answers: tuple[int, Any]) -> None:
        _Endpoint.script["/v1/chat/completions"] = [(status, body, {}) for status, body in answers]

    def chat_requests(self) -> list[dict[str, Any]]:
        return [seen for seen in _Endpoint.seen if seen["path"] == "/v1/chat/completions"]


class ExternalEngineTests(_ExternalEngineCase):
    def test_no_sidecar_starts_and_every_request_carries_the_bearer_key(self):
        engine = self.engine()
        self.answer_chat((200, chat_answer("openai", json.dumps({"answer": "ok"}))))

        self.assertTrue(engine.status()["available"])
        self.assertEqual(engine.invoke(CHAT_PAYLOAD)["answer"], "ok")

        self.assertEqual([seen["authorization"] for seen in _Endpoint.seen], [f"Bearer {KEY}"] * 2)
        self.assertEqual(self.chat_requests()[0]["body"]["model"], "gpt-4o-mini")

    def test_health_is_get_v1_models_and_tokens_are_estimated(self):
        engine = self.engine()
        engine.status()
        self.assertEqual(
            [(s["method"], s["path"]) for s in _Endpoint.seen], [("GET", "/v1/models")]
        )
        self.assertEqual(engine.count_tokens("x" * 10), 4)
        self.assertEqual(len(_Endpoint.seen), 1, "no /tokenize request")

    def test_the_status_shows_neither_the_key_nor_the_url(self):
        status = self.engine().status()
        self.assertEqual(status["mode"], "external")
        self.assertEqual(status["model"], "gpt-4o-mini")
        self.assertNotIn(KEY, json.dumps(status))
        self.assertNotIn(self.url, json.dumps(status))

    def test_an_error_body_echoing_the_key_is_redacted_and_cut(self):
        engine = self.engine()
        echoed = f"upstream failed for Authorization: Bearer {KEY} " + "x" * 2000
        self.answer_chat((500, {"error": {"message": echoed}}))

        with self.assertRaises(RuntimeError) as caught:
            engine.invoke(CHAT_PAYLOAD)

        message = str(caught.exception)
        self.assertNotIn(KEY, message)
        self.assertIn("***", message)
        self.assertLess(len(message), 400)

    def test_the_key_is_not_in_the_log_or_the_reply_and_audit(self):
        engine = self.engine()
        reply = {"message": "Alles bereit.", "citations": [], "proposals": []}
        # The answer comes through the read-tool loop, which wraps it as its final step.
        final = {"action": "final", "final": reply}
        self.answer_chat((200, chat_answer("openai", json.dumps(final))))
        runtime = AssistantRuntime(
            Path("."),
            Path("."),
            engine,
            progress=cast(Any, RuntimeProgress()),
            read_tools=cast(Any, RuntimeReadTools()),
            token_cache=BoundedTokenCountCache(),
            debug_enabled=True,
        )
        printed = io.StringIO()
        with (
            self.assertLogs("quiltor", level="DEBUG") as logs,
            contextlib.redirect_stdout(printed),
            contextlib.redirect_stderr(printed),
        ):
            result = runtime.complete("Wie geht es Tarek?", {}, FIGURES, history=None)
            status = runtime.status()
            logging.getLogger("quiltor.test").debug("probe so the capture is never empty")

        self.assertEqual(result["message"], "Alles bereit.")
        self.assertNotIn(KEY, json.dumps(result, default=str))  # includes the reply's audit
        self.assertNotIn(KEY, json.dumps(status, default=str))
        self.assertNotIn(KEY, "\n".join(logs.output))
        self.assertNotIn(KEY, printed.getvalue())


class ExternalHealthRedirectTests(_ExternalEngineCase):
    def test_a_redirect_from_v1_models_is_not_followed(self):
        target_seen: list[str | None] = []

        class Target(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

            def do_GET(self) -> None:
                target_seen.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()

        target, target_url = _serve(Target)
        self.addCleanup(target.server_close)
        self.addCleanup(target.shutdown)
        _Endpoint.script["/v1/models"] = [(302, {}, {"Location": f"{target_url}/v1/models"})]

        status = self.engine().status()

        self.assertFalse(status["available"])
        self.assertEqual(target_seen, [], "the redirect target saw a request")


# --- json_schema and its fallback, per provider ---------------------------------------------


class OpenAiContractTests(_ExternalEngineCase):
    provider = "openai"

    def test_models_and_a_strict_json_schema_chat(self):
        engine = self.engine()
        self.answer_chat((200, chat_answer(self.provider, json.dumps({"answer": "ok"}))))

        self.assertTrue(engine.status()["available"])
        result = engine.invoke(CHAT_PAYLOAD)

        self.assertEqual(result["answer"], "ok")
        self.assertEqual(result["_runtime"]["promptTokens"], 12)
        sent = self.chat_requests()[0]["body"]
        self.assertEqual(sent["response_format"]["type"], "json_schema")
        self.assertEqual(sent["response_format"]["json_schema"]["schema"], SCHEMA)

    def test_a_refused_json_schema_is_retried_once_with_json_object(self):
        engine = self.engine()
        status, body = JSON_SCHEMA_REFUSALS[self.provider]
        self.answer_chat(
            (status, body),
            (200, chat_answer(self.provider, json.dumps({"answer": "ok"}))),
        )

        self.assertEqual(engine.invoke(CHAT_PAYLOAD)["answer"], "ok")

        first, second = (request["body"] for request in self.chat_requests())
        self.assertEqual(first["response_format"]["type"], "json_schema")
        self.assertEqual(second["response_format"], {"type": "json_object"})
        self.assertIn('"required":["answer"]', second["messages"][0]["content"])
        self.assertTrue(second["messages"][0]["content"].startswith("Du bist hilfsbereit."))

        # Remembered: the next request goes straight to json_object, without a refusal first.
        self.answer_chat((200, chat_answer(self.provider, json.dumps({"answer": "again"}))))
        _Endpoint.seen.clear()
        self.assertEqual(engine.invoke(CHAT_PAYLOAD)["answer"], "again")
        self.assertEqual(
            self.chat_requests()[0]["body"]["response_format"], {"type": "json_object"}
        )

    def test_a_second_refusal_is_not_retried_again(self):
        engine = self.engine()
        status, body = JSON_SCHEMA_REFUSALS[self.provider]
        self.answer_chat((status, body))

        with self.assertRaisesRegex(RuntimeError, f"HTTP {status}"):
            engine.invoke(CHAT_PAYLOAD)
        self.assertEqual(len(self.chat_requests()), 2)

    def test_an_unrelated_error_is_not_retried(self):
        engine = self.engine()
        self.answer_chat((400, {"error": {"message": "max_tokens is too large"}}))

        with self.assertRaisesRegex(RuntimeError, "HTTP 400"):
            engine.invoke(CHAT_PAYLOAD)
        self.assertEqual(len(self.chat_requests()), 1)


class OpenRouterContractTests(OpenAiContractTests):
    provider = "openrouter"


class AnthropicContractTests(_ExternalEngineCase):
    """Anthropic's OpenAI-compatible endpoint ignores response_format instead of refusing it, so
    nothing can be learnt from an error: QUILTOR_AI_JSON_MODE=json_object says so up front."""

    provider = "anthropic"

    def test_models_and_a_json_object_chat_when_configured(self):
        os.environ["QUILTOR_AI_JSON_MODE"] = "json_object"
        engine = self.engine()
        self.answer_chat((200, chat_answer(self.provider, json.dumps({"answer": "ok"}))))

        self.assertTrue(engine.status()["available"])
        self.assertEqual(engine.invoke(CHAT_PAYLOAD)["answer"], "ok")

        requests = self.chat_requests()
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]["body"]["response_format"], {"type": "json_object"})
        self.assertIn("JSON schema", requests[0]["body"]["messages"][0]["content"])


class JsonObjectFallbackTests(unittest.TestCase):
    def test_a_payload_without_a_system_message_gets_one(self):
        payload = {**CHAT_PAYLOAD, "messages": [{"role": "user", "content": "Hallo"}]}
        fallback = json_object_fallback(payload)
        self.assertEqual(fallback["messages"][0]["role"], "system")
        self.assertEqual(fallback["messages"][1], {"role": "user", "content": "Hallo"})
        self.assertEqual(payload["response_format"]["type"], "json_schema", "input untouched")

    def test_a_payload_without_json_schema_is_left_alone(self):
        payload = {"messages": [{"role": "user", "content": "Hallo"}]}
        self.assertIs(json_object_fallback(payload), payload)


class LocalModeUnchangedTests(unittest.TestCase):
    def test_without_a_key_the_engine_starts_its_sidecar_and_counts_with_tokenize(self):
        with patch.dict(os.environ):
            for name in ("QUILTOR_AI_URL", "QUILTOR_AI_KEY", "QUILTOR_AI_KEY_FILE"):
                os.environ.pop(name, None)
            with patch.object(
                engine_module.select, "start_runtime", return_value=None
            ) as start_runtime:
                engine = engine_module.LocalInferenceEngine(
                    Path("."), Path("."), cast(Any, _Capabilities())
                )
        self.assertTrue(start_runtime.called)
        self.assertFalse(engine.endpoint.external)
        with patch.object(engine_module, "count_tokens", return_value=7) as tokenize:
            self.assertEqual(engine.count_tokens("Hallo"), 7)
        tokenize.assert_called_once()


if __name__ == "__main__":
    unittest.main()
