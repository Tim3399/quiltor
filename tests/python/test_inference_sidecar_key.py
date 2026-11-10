"""The local inference sidecar answers only to the key Quiltor started it with (T-58 P4).

A local process or a page in the browser must not reach the model without that key, the key
never appears in a process list, and a redirect never carries it to another host.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar, cast
from unittest.mock import patch

from quiltor import resources
from quiltor.infrastructure.inference import engine as engine_module
from quiltor.infrastructure.inference.runtimes import llamacpp, mlx
from quiltor.infrastructure.inference.shared.contract import count_tokens, invoke_chat
from tests.python import late_body

KEY = "sidecar-test-key-0123456789"
CHAT_PAYLOAD = {"messages": [{"role": "user", "content": "Hallo"}]}


def _serve(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


class _Quiet(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _reply(self, status: int, body: dict[str, Any], headers: dict[str, str] | None = None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def _drain(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length", "0")))


class _FakeSidecar(_Quiet):
    """Behaves like llama-server started with --api-key: 401 unless the bearer matches."""

    seen: ClassVar[list[str | None]] = []

    def do_POST(self) -> None:
        self._drain()
        supplied = self.headers.get("Authorization")
        type(self).seen.append(supplied)
        if supplied != f"Bearer {KEY}":
            self._reply(401, {"error": {"message": "Invalid API Key"}})
        elif self.path == "/tokenize":
            self._reply(200, {"tokens": [1, 2, 3]})
        else:
            content = json.dumps({"answer": "ok"})
            self._reply(
                200,
                {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]},
            )


class SidecarKeyOnTheWireTests(unittest.TestCase):
    def setUp(self):
        _FakeSidecar.seen = []
        self.server, self.url = _serve(_FakeSidecar)
        # Cleanups run last-in first-out: stop serving before the socket closes.
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_the_sidecar_refuses_a_request_without_or_with_a_wrong_key_and_answers_the_right_one(
        self,
    ):
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            invoke_chat(self.url, CHAT_PAYLOAD)
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            invoke_chat(self.url, CHAT_PAYLOAD, api_key="wrong")
        self.assertEqual(invoke_chat(self.url, CHAT_PAYLOAD, api_key=KEY), {"answer": "ok"})

        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            count_tokens(self.url, "Hallo")
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            count_tokens(self.url, "Hallo", api_key="wrong")
        self.assertEqual(count_tokens(self.url, "Hallo", api_key=KEY), 3)

    def test_the_engine_sends_the_key_it_started_the_sidecar_with(self):
        started: list[str | None] = []

        def start_runtime(_base, _data, _url, key=None):
            started.append(key)
            return None

        class Capabilities:
            def is_available(self, _feature):
                return True

        with (
            patch.dict(os.environ),
            patch.object(engine_module.select, "start_runtime", side_effect=start_runtime),
        ):
            os.environ.pop("QUILTOR_AI_URL", None)
            engine = engine_module.LocalInferenceEngine(
                Path("."),
                Path("."),
                cast(Any, Capabilities()),  # type: ignore[arg-type]
            )
        engine.url = self.url

        self.assertEqual(len(started), 1)
        key = started[0]
        self.assertTrue(key and len(key) >= 32, "the engine starts the sidecar with a fresh key")
        with patch.object(engine, "_sidecar_key", KEY):
            self.assertEqual(engine.invoke(CHAT_PAYLOAD)["answer"], "ok")
            self.assertEqual(engine.count_tokens("Hallo"), 3)
        self.assertEqual(_FakeSidecar.seen, [f"Bearer {KEY}", f"Bearer {KEY}"])

    def test_every_engine_has_its_own_key(self):
        class Capabilities:
            def is_available(self, _feature):
                return False

        with patch.dict(os.environ):
            os.environ.pop("QUILTOR_AI_URL", None)
            first = engine_module.LocalInferenceEngine(
                Path("."), Path("."), cast(Any, Capabilities())
            )  # type: ignore[arg-type]
            second = engine_module.LocalInferenceEngine(
                Path("."), Path("."), cast(Any, Capabilities())
            )  # type: ignore[arg-type]
        self.assertNotEqual(first._sidecar_key, second._sidecar_key)


class _RedirectTarget(_Quiet):
    """Server B: anything arriving here would have been carried by a followed redirect."""

    seen: ClassVar[list[dict[str, str]]] = []

    def do_POST(self) -> None:
        self._drain()
        type(self).seen.append(dict(self.headers))
        self._reply(200, {"tokens": [1], "choices": []})


class RedirectTests(unittest.TestCase):
    def setUp(self):
        _RedirectTarget.seen = []
        self.target, target_url = _serve(_RedirectTarget)
        # Cleanups run last-in first-out: stop serving before the socket closes.
        self.addCleanup(self.target.server_close)
        self.addCleanup(self.target.shutdown)

        class Redirecting(_Quiet):
            def do_POST(self) -> None:
                self._drain()
                self._reply(302, {}, {"Location": f"{target_url}{self.path}"})

        self.source, self.url = _serve(Redirecting)
        # Cleanups run last-in first-out: stop serving before the socket closes.
        self.addCleanup(self.source.server_close)
        self.addCleanup(self.source.shutdown)

    def _assert_refused(self, call) -> None:
        with self.assertRaises(RuntimeError) as caught:
            call()
        message = str(caught.exception)
        self.assertIn("302", message)
        self.assertNotIn(KEY, message)
        self.assertNotIn("Authorization", message)
        self.assertEqual(_RedirectTarget.seen, [], "the redirect target saw a request")

    def test_a_redirect_from_the_chat_endpoint_is_not_followed(self):
        self._assert_refused(lambda: invoke_chat(self.url, CHAT_PAYLOAD, api_key=KEY))

    def test_a_redirect_from_the_tokenizer_is_not_followed(self):
        self._assert_refused(lambda: count_tokens(self.url, "Hallo", api_key=KEY))


class _RecordingSupervisor:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def spawn(self, argv, **kwargs):
        self.calls.append({"argv": list(argv), **kwargs})
        return object()


class LaunchTests(unittest.TestCase):
    """The key reaches the runtime through its environment and never through argv."""

    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("QUILTOR_MODELS_DIR", None)
        os.environ.pop("LLAMA_API_KEY", None)
        os.environ.pop("QUILTOR_SIDECAR_KEY", None)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.base = Path(folder.name)
        (self.base / "data").mkdir()
        self.supervisor = _RecordingSupervisor()
        supervisor = patch(
            "quiltor.infrastructure.inference.runtimes.process_supervisor",
            return_value=self.supervisor,
        )
        supervisor.start()
        self.addCleanup(supervisor.stop)

    def _launched(self) -> dict[str, Any]:
        self.assertEqual(len(self.supervisor.calls), 1)
        call = self.supervisor.calls[0]
        call["stdout"].close()
        return call

    def test_llama_server_gets_the_key_in_its_environment_and_not_in_argv(self):
        binary = self.base / "runtime" / llamacpp.binary_name()
        model = self.base / "models" / "model.gguf"
        binary.parent.mkdir(parents=True)
        model.parent.mkdir(parents=True)
        binary.touch()
        model.touch()

        llamacpp.start(self.base, self.base / "data", "http://127.0.0.1:8123", None, None, KEY)

        call = self._launched()
        self.assertFalse(any(KEY in part for part in call["argv"]), call["argv"])
        self.assertNotIn("--api-key", call["argv"])
        self.assertEqual(call["env"]["LLAMA_API_KEY"], KEY)
        # The rest of the environment is inherited, not replaced.
        self.assertEqual(call["env"].get("PATH"), os.environ.get("PATH"))

    def test_the_mlx_bridge_gets_the_key_in_its_environment_and_not_in_argv(self):
        python = self.base / "runtime" / "mlx-venv" / "bin" / "python3"
        bridge = self.base / "bridge.py"
        model = self.base / "models" / "mlx" / "model"
        python.parent.mkdir(parents=True)
        model.mkdir(parents=True)
        python.touch()
        bridge.touch()
        (model / "config.json").write_text(json.dumps({"model_type": "qwen3"}))

        with patch(
            "quiltor.infrastructure.inference.runtimes.mlx.resources.sidecar_asset",
            return_value=bridge,
        ):
            mlx.start(self.base, self.base / "data", "http://127.0.0.1:8124", None, None, KEY)

        call = self._launched()
        self.assertFalse(any(KEY in part for part in call["argv"]), call["argv"])
        self.assertEqual(call["env"]["QUILTOR_SIDECAR_KEY"], KEY)

    def test_without_a_key_the_runtime_inherits_the_environment_unchanged(self):
        binary = self.base / "runtime" / llamacpp.binary_name()
        model = self.base / "models" / "model.gguf"
        binary.parent.mkdir(parents=True)
        model.parent.mkdir(parents=True)
        binary.touch()
        model.touch()

        llamacpp.start(self.base, self.base / "data", "http://127.0.0.1:8123", None, None)

        self.assertIsNone(self._launched()["env"])


def _load_bridge():
    path = resources.sidecar_asset("inference/mlx/bridge.py")
    spec = importlib.util.spec_from_file_location("quiltor_mlx_bridge_under_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BridgeLogTests(unittest.TestCase):
    """What the bridge prints lands in its log file next to the data (T-64, F-58-6)."""

    def test_the_key_never_reaches_the_bridge_log(self):
        env = patch.dict(os.environ, {"QUILTOR_SIDECAR_KEY": KEY})
        env.start()
        self.addCleanup(env.stop)
        bridge = _load_bridge()

        class Tokenizer:
            def encode(self, text):
                return list(range(len(text.split())))

        bridge.STATE.update(ready=True, tokenizer=Tokenizer())
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            server, url = _serve(bridge.Handler)
            try:
                count_tokens(url, "zwei Worte", api_key=KEY)
                with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                    count_tokens(url, "zwei Worte", api_key=f"{KEY}-wrong")
                with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                    invoke_chat(url, CHAT_PAYLOAD)
            finally:
                server.shutdown()
                server.server_close()
        log = printed.getvalue()
        self.assertIn("MLX bridge:", log, "the bridge logged nothing, so nothing was checked")
        self.assertNotIn(KEY, log)


class BridgeHandlerTests(unittest.TestCase):
    """The MLX bridge itself, without MLX: its handler with a stand-in tokenizer."""

    def setUp(self):
        env = patch.dict(os.environ, {"QUILTOR_SIDECAR_KEY": KEY})
        env.start()
        self.addCleanup(env.stop)
        bridge = _load_bridge()

        class Tokenizer:
            def encode(self, text):
                return list(range(len(text.split())))

        bridge.STATE.update(ready=True, tokenizer=Tokenizer())
        bridge.Handler.log_message = lambda *_args: None
        self.server, self.url = _serve(bridge.Handler)
        # Cleanups run last-in first-out: stop serving before the socket closes.
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_the_bridge_refuses_a_missing_or_wrong_key_and_answers_the_right_one(self):
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            count_tokens(self.url, "zwei Worte")
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            count_tokens(self.url, "zwei Worte", api_key="wrong")
        self.assertEqual(count_tokens(self.url, "zwei Worte", api_key=KEY), 2)

    def test_the_bridge_refuses_chat_without_the_key(self):
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            invoke_chat(self.url, CHAT_PAYLOAD)

    def test_health_needs_no_key(self):
        import urllib.request

        with urllib.request.urlopen(f"{self.url}/health", timeout=5) as response:
            self.assertEqual(response.status, 200)


class BridgeRefusalBodyTests(unittest.TestCase):
    """A refused request still gets its whole answer, even when its body comes late.

    The bridge answers 401, 404 and 503 before it reads the body. Closing a socket with unread
    bytes resets the connection on Windows, and the client loses the answer that was already on
    its way -- the same failure the server's early refusals had (D-38). See
    tests/python/late_body.py for why the body is sent after the headers; sent like this, it
    happens every time the bridge forgets to drop the body.
    """

    BODY = json.dumps({"content": "zwei Worte"}).encode()

    def setUp(self):
        env = patch.dict(os.environ, {"QUILTOR_SIDECAR_KEY": KEY})
        env.start()
        self.addCleanup(env.stop)
        self.bridge = _load_bridge()
        self.bridge.STATE.update(ready=True, tokenizer=None)
        self.bridge.Handler.log_message = lambda *_args: None
        server, _url = _serve(self.bridge.Handler)
        self.port = server.server_address[1]
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

    def _post(self, path: str, *, key: str | None = None, body: bytes | None = None, **options):
        headers = {"Content-Type": "application/json"}
        if key is not None:
            headers["Authorization"] = f"Bearer {key}"
        return late_body.send(
            self.port,
            "POST",
            path,
            headers=headers,
            body=self.BODY if body is None else body,
            **options,
        )

    def test_a_missing_key_gets_its_whole_401(self):
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = self._post("/tokenize")
                self.assertEqual(answer.status, 401, answer.body[:200])
                self.assertEqual(answer.json()["error"], "invalid api key")

    def test_a_wrong_key_gets_its_whole_401_even_with_a_large_body(self):
        large = json.dumps({"content": "wort " * 8000}).encode()
        self.assertGreater(len(large), 32 * 1024)
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = self._post("/v1/chat/completions", key="wrong", body=large)
                self.assertEqual(answer.status, 401, answer.body[:200])

    def test_an_unknown_route_gets_its_whole_404(self):
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = self._post("/no-such-route", key=KEY)
                self.assertEqual(answer.status, 404, answer.body[:200])

    def test_a_bridge_that_is_still_loading_gets_its_whole_503(self):
        self.bridge.STATE.update(ready=False)
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = self._post("/tokenize", key=KEY)
                self.assertEqual(answer.status, 503, answer.body[:200])

    def _refusal_with_an_open_connection(self, length: int) -> tuple[bytes, float]:
        """A request that promises `length` bytes, never sends them and never hangs up."""
        head = (
            "POST /tokenize HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
            f"Content-Length: {length}\r\n\r\n"
        )
        deadline = self.bridge.REFUSED_BODY_DISCARD_TIMEOUT_SECONDS + 2
        with socket.create_connection(("127.0.0.1", self.port), timeout=deadline) as client:
            started = time.monotonic()
            client.sendall(head.encode())
            response = b""
            while chunk := client.recv(65536):
                response += chunk
            return response, time.monotonic() - started

    def test_an_oversized_content_length_is_not_waited_for(self):
        response, elapsed = self._refusal_with_an_open_connection(
            self.bridge.REFUSED_BODY_DISCARD_LIMIT + 1
        )
        self.assertTrue(response.startswith(b"HTTP/1.0 401"), response[:80])
        self.assertLess(elapsed, 1.0)

    def test_a_trickled_body_is_given_up_on_as_a_whole(self):
        """One byte every 1.5 s never trips a per-read timeout; the one deadline holds."""
        answer = late_body.trickle(
            self.port,
            "/tokenize",
            headers={"Content-Type": "application/json"},
            length=100,
            interval=1.5,
            deadline=10.0,
        )
        self.assertEqual(answer.status, 401, answer.body[:200])
        self.assertLess(answer.elapsed, self.bridge.REFUSED_BODY_DISCARD_TIMEOUT_SECONDS + 1.5)

    def test_a_promised_body_that_never_comes_is_given_up_on(self):
        response, elapsed = self._refusal_with_an_open_connection(100)
        self.assertTrue(response.startswith(b"HTTP/1.0 401"), response[:80])
        self.assertLess(elapsed, self.bridge.REFUSED_BODY_DISCARD_TIMEOUT_SECONDS + 2)

    def test_a_request_with_the_right_key_is_still_answered(self):
        class Tokenizer:
            def encode(self, text):
                return list(range(len(text.split())))

        self.bridge.STATE.update(tokenizer=Tokenizer())
        answer = self._post("/tokenize", key=KEY)
        self.assertEqual(answer.status, 200, answer.body[:200])
        self.assertEqual(answer.json(), {"tokens": [0, 1]})


if __name__ == "__main__":
    unittest.main()
