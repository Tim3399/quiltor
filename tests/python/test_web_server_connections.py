"""What the web server does when many connections arrive at once.

Both tests here came out of a CI run in which four tests failed against a port that was
open: the server kept running and logging while the caller got "connection refused". The
cause was not in the server but in the number it gives the operating system for its
queue -- and it was found later than it needed to be, because the log was full of
tracebacks from browsers that had simply walked away.
"""

import http.client
import io
import json
import os
from pathlib import Path
import socket
import socketserver
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories
from quiltor.modules.identity import service as identity


class ProbeHandler(server.Handler):
    handled: list["ProbeHandler"] = []
    state_before_head: list[tuple[list, object, int]] = []

    def _respond(self, code: int = 200, body: bytes = b"ok") -> None:
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def end_headers(self) -> None:
        redirect = getattr(self, identity.REDIRECT_ATTR, None)
        if redirect is not None:
            self.send_header("X-Probe-Redirect", redirect)
        super().end_headers()

    def do_GET(self) -> None:
        self.handled.append(self)
        if self.path == "/prime-state":
            self._pending_cookies.append(("Set-Cookie", "request-state=leaked"))
            setattr(self, identity.REDIRECT_ATTR, "/leaked")
        self._respond()

    def do_HEAD(self) -> None:
        self.handled.append(self)
        self.state_before_head.append(
            (
                list(self._pending_cookies),
                getattr(self, identity.REDIRECT_ATTR, None),
                self._response_status,
            )
        )
        self._respond()

    def do_POST(self) -> None:
        # Deliberately reject without reading the body. The connection policy must
        # prevent those bytes from being parsed as another request.
        self.handled.append(self)
        if self.path == "/header-blocks":
            self.send_response_only(103)
            self.send_header("Connection", "keep-alive")
            self.close_connection = True
            self.end_headers()
        self._respond(403, b"rejected")


class ServerConnectionTests(unittest.TestCase):
    def setUp(self):
        ProbeHandler.handled = []
        ProbeHandler.state_before_head = []

    def start_probe_server(self):
        application = SimpleNamespace(public_assets=Path.cwd())
        httpd = server.Server(("127.0.0.1", 0), ProbeHandler, application)
        thread = threading.Thread(
            target=httpd.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        thread.start()

        def stop():
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

        self.addCleanup(stop)
        return httpd

    def build_application(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        directories = AppDirectories(
            data=root,
            config=root / "config",
            cache=root / "cache",
            models=root / "models",
            logs=root / "logs",
            temp=root / "temp",
        )
        assistant_services = AssistantServices(MagicMock(), MagicMock())
        environment = patch.dict(
            os.environ, {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": ""}
        )
        environment.start()
        self.addCleanup(environment.stop)
        with patch(
            "quiltor.bootstrap.web.build_assistant_services",
            return_value=assistant_services,
        ):
            application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=directories,
            )
        application.prepare()
        self.addCleanup(application.close)
        public_assets = root / "public"
        public_assets.mkdir()
        application.public_assets = public_assets
        return application

    def test_real_static_and_api_gets_reuse_one_accepted_connection(self):
        application = self.build_application()
        (application.public_assets / "asset.js").write_text("real asset", encoding="utf-8")
        httpd = server.Server(("127.0.0.1", 0), server.Handler, application)
        accepted_clients = []
        original_get_request = httpd.get_request

        def record_accepted_client():
            request, address = original_get_request()
            accepted_clients.append(address)
            return request, address

        httpd.get_request = record_accepted_client
        thread = threading.Thread(
            target=httpd.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        thread.start()

        def stop():
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

        self.addCleanup(stop)
        connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
        self.addCleanup(connection.close)

        connection.request("GET", "/asset.js")
        static_response = connection.getresponse()
        self.assertEqual(static_response.read(), b"real asset")
        client_port = connection.sock.getsockname()[1]

        connection.request("GET", "/api/version")
        api_response = connection.getresponse()
        api_body = json.loads(api_response.read())

        self.assertEqual(static_response.version, 11)
        self.assertEqual(api_response.version, 11)
        self.assertTrue(api_body["ok"])
        self.assertEqual(len(accepted_clients), 1)
        self.assertEqual(accepted_clients[0][1], client_port)

    def test_bodyless_http11_gets_reuse_one_connection_for_static_and_api(self):
        httpd = self.start_probe_server()
        connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
        self.addCleanup(connection.close)

        connection.request("GET", "/asset.js")
        first = connection.getresponse()
        self.assertEqual(first.read(), b"ok")
        first_socket = connection.sock

        connection.request("GET", "/api/version")
        second = connection.getresponse()
        self.assertEqual(second.read(), b"ok")

        self.assertEqual(first.version, 11)
        self.assertEqual(second.version, 11)
        self.assertIs(connection.sock, first_socket)
        self.assertEqual(len(ProbeHandler.handled), 2)
        self.assertIs(ProbeHandler.handled[0], ProbeHandler.handled[1])

    def test_ambiguous_or_non_read_requests_explicitly_close(self):
        cases = (
            ("GET", {"Connection": "close"}),
            ("GET", {"Content-Length": "0"}),
            ("GET", {"Transfer-Encoding": "chunked"}),
            ("GET", {"Expect": "100-continue"}),
            ("GET", {"Connection": "Upgrade", "Upgrade": "websocket"}),
            ("HEAD", {}),
            ("POST", {"Content-Length": "0"}),
        )

        for method, headers in cases:
            with self.subTest(method=method, headers=headers):
                httpd = self.start_probe_server()
                connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
                connection.request(method, "/probe", headers=headers)
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 200 if method != "POST" else 403)
                self.assertEqual(response.getheader("Connection"), "close")
                self.assertTrue(response.will_close)
                connection.close()

    def test_http10_get_explicitly_closes(self):
        httpd = self.start_probe_server()
        with socket.create_connection(httpd.server_address, timeout=2) as client:
            client.sendall(b"GET /probe HTTP/1.0\r\nHost: localhost\r\n\r\n")
            response = self._read_to_close(client)

        self.assertIn(b"HTTP/1.1 200 OK", response)
        self.assertIn(b"Connection: close", response)

    def test_expect_continue_only_advertises_close_on_the_final_response(self):
        httpd = self.start_probe_server()
        with socket.create_connection(httpd.server_address, timeout=2) as client:
            client.sendall(
                b"POST /reject HTTP/1.1\r\n"
                b"Host: localhost\r\n"
                b"Content-Length: 0\r\n"
                b"Expect: 100-continue\r\n"
                b"Connection: close\r\n\r\n"
            )
            response = self._read_to_close(client)

        interim, final = response.split(b"HTTP/1.1 403 Forbidden", 1)
        self.assertEqual(interim, b"HTTP/1.1 100 Continue\r\n\r\n")
        self.assertIn(b"Connection: close\r\n", final)

    def test_connection_header_tracking_is_scoped_to_one_header_block(self):
        httpd = self.start_probe_server()
        with socket.create_connection(httpd.server_address, timeout=2) as client:
            client.sendall(
                b"POST /header-blocks HTTP/1.1\r\n"
                b"Host: localhost\r\n"
                b"Content-Length: 0\r\n"
                b"Connection: close\r\n\r\n"
            )
            response = self._read_to_close(client)

        informational, final = response.split(b"HTTP/1.1 403 Forbidden", 1)
        self.assertIn(b"HTTP/1.1 103 Early Hints", informational)
        self.assertIn(b"Connection: keep-alive\r\n", informational)
        self.assertIn(b"Connection: close\r\n", final)

    def test_rejected_post_does_not_parse_unread_body_as_a_second_request(self):
        httpd = self.start_probe_server()
        with socket.create_connection(httpd.server_address, timeout=2) as client:
            client.sendall(
                b"POST /reject HTTP/1.1\r\n"
                b"Host: localhost\r\n"
                b"Content-Length: 4\r\n\r\n"
                b"GET /must-not-run HTTP/1.1\r\nHost: localhost\r\n\r\n"
            )
            response = self._read_to_close(client)

        self.assertIn(b"HTTP/1.1 403 Forbidden", response)
        self.assertEqual(len(ProbeHandler.handled), 1)
        self.assertEqual(ProbeHandler.handled[0].command, "POST")

    def test_request_state_is_reset_before_head_and_malformed_requests(self):
        httpd = self.start_probe_server()
        connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
        self.addCleanup(connection.close)
        connection.request("GET", "/prime-state")
        first = connection.getresponse()
        first.read()
        self.assertEqual(first.getheader("Set-Cookie"), "request-state=leaked")
        self.assertEqual(first.getheader("X-Probe-Redirect"), "/leaked")

        connection.request("HEAD", "/probe")
        head = connection.getresponse()
        head.read()
        self.assertIsNone(head.getheader("Set-Cookie"))
        self.assertIsNone(head.getheader("X-Probe-Redirect"))
        self.assertEqual(ProbeHandler.state_before_head, [([], None, 0)])

        with socket.create_connection(httpd.server_address, timeout=2) as client:
            client.sendall(
                b"GET /prime-state HTTP/1.1\r\nHost: localhost\r\n\r\n"
                b"GET /bad HTTP/1.1\r\nHost: localhost\r\nX-Long: " + (b"x" * 65537) + b"\r\n\r\n"
            )
            response = self._read_to_close(client)

        self.assertEqual(response.count(b"Set-Cookie: request-state=leaked"), 1)
        self.assertEqual(response.count(b"X-Probe-Redirect: /leaked"), 1)
        self.assertIn(b"HTTP/1.1 431 Line too long", response)

    def test_idle_connection_expires(self):
        with patch.object(server, "REQUEST_HEADER_TIMEOUT_SECONDS", 0.05):
            httpd = self.start_probe_server()
            for partial_request in (b"", b"GET / HTTP/1.1\r\nHost:"):
                with self.subTest(partial_request=partial_request):
                    with socket.create_connection(httpd.server_address, timeout=2) as client:
                        if partial_request:
                            client.sendall(partial_request)
                        client.settimeout(1)
                        self.assertEqual(client.recv(1), b"")

            connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
            self.addCleanup(connection.close)
            connection.request("GET", "/probe")
            response = connection.getresponse()
            self.assertEqual(response.read(), b"ok")
            kept_alive_socket = connection.sock
            kept_alive_socket.settimeout(1)
            self.assertEqual(kept_alive_socket.recv(1), b"")

    def test_connection_backlog_exceeds_the_socketserver_default(self):
        """What is checked is the number that really reaches ``listen()``.

        Not the class attribute: ``server_activate`` passes it on, and only what arrives
        there tells the operating system how many may wait.
        """

        passed_backlogs: list[int | None] = []
        original_listen = socket.socket.listen

        def listen_spy(self, backlog=None):
            passed_backlogs.append(backlog)
            return original_listen(self) if backlog is None else original_listen(self, backlog)

        with patch.object(socket.socket, "listen", listen_spy):
            httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
            httpd.server_close()

        self.assertEqual(len(passed_backlogs), 1)
        self.assertIsNotNone(passed_backlogs[0])
        # Five is socketserver's default and the reason Windows refused.
        self.assertGreater(passed_backlogs[0], socketserver.TCPServer.request_queue_size)
        self.assertGreaterEqual(passed_backlogs[0], 128)

    def test_a_disconnected_browser_does_not_produce_a_traceback(self):
        httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
        self.addCleanup(httpd.server_close)

        for error in (
            BrokenPipeError("disconnected"),
            ConnectionAbortedError("disconnected"),
            ConnectionResetError("disconnected"),
        ):
            with self.subTest(error=type(error).__name__):
                self.assertEqual(self._error_log(httpd, error), "")

    def test_an_unexpected_error_remains_visible(self):
        httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
        self.addCleanup(httpd.server_close)

        self.assertIn("ValueError", self._error_log(httpd, ValueError("broken")))

    @staticmethod
    def _error_log(httpd: server.Server, error: Exception) -> str:
        buffer = io.StringIO()
        previous, sys.stderr = sys.stderr, buffer
        try:
            raise error
        except Exception:
            httpd.handle_error(None, ("127.0.0.1", 0))
        finally:
            sys.stderr = previous
        return buffer.getvalue()

    @staticmethod
    def _read_to_close(client: socket.socket) -> bytes:
        client.settimeout(2)
        chunks = []
        while chunk := client.recv(65536):
            chunks.append(chunk)
        return b"".join(chunks)


if __name__ == "__main__":
    unittest.main()
