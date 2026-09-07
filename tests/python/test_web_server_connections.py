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
    def test_die_warteschlange_ist_groesser_als_die_vorgabe_von_socketserver(self):
        """What is checked is the number that really reaches ``listen()``.

        Not the class attribute: ``server_activate`` passes it on, and only what arrives
        there tells the operating system how many may wait.
        """

        uebergeben: list[int | None] = []
        echtes_listen = socket.socket.listen

        def spion(self, backlog=None):
            uebergeben.append(backlog)
            return echtes_listen(self) if backlog is None else echtes_listen(self, backlog)

        with patch.object(socket.socket, "listen", spion):
            httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
            httpd.server_close()

        self.assertEqual(len(uebergeben), 1)
        self.assertIsNotNone(uebergeben[0])
        # Five is socketserver's default and the reason Windows refused.
        self.assertGreater(uebergeben[0], socketserver.TCPServer.request_queue_size)
        self.assertGreaterEqual(uebergeben[0], 128)

    def test_ein_weggegangener_browser_erzeugt_keinen_traceback(self):
        httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
        self.addCleanup(httpd.server_close)

        for fehler in (
            BrokenPipeError("weg"),
            ConnectionAbortedError("weg"),
            ConnectionResetError("weg"),
        ):
            with self.subTest(fehler=type(fehler).__name__):
                self.assertEqual(self._protokoll_von(httpd, fehler), "")

    def test_ein_echter_fehler_bleibt_sichtbar(self):
        httpd = server.Server(("127.0.0.1", 0), server.Handler, None)
        self.addCleanup(httpd.server_close)

        self.assertIn("ValueError", self._protokoll_von(httpd, ValueError("kaputt")))

    @staticmethod
    def _protokoll_von(httpd: server.Server, fehler: Exception) -> str:
        puffer = io.StringIO()
        vorher, sys.stderr = sys.stderr, puffer
        try:
            raise fehler
        except Exception:
            httpd.handle_error(None, ("127.0.0.1", 0))
        finally:
            sys.stderr = vorher
        return puffer.getvalue()


if __name__ == "__main__":
    unittest.main()
