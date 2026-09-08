"""What the web server does when many connections arrive at once.

Both tests here came out of a CI run in which four tests failed against a port that was
open: the server kept running and logging while the caller got "connection refused". The
cause was not in the server but in the number it gives the operating system for its
queue -- and it was found later than it needed to be, because the log was full of
tracebacks from browsers that had simply walked away.
"""

import io
import socket
import socketserver
import sys
import unittest
from unittest.mock import patch

from quiltor.hosts.web import server


class ServerConnectionTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
