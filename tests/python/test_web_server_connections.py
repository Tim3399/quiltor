"""Was der Webserver tut, wenn viele Verbindungen gleichzeitig ankommen.

Beides hier ist aus einem CI-Lauf entstanden, in dem vier Tests an einem Port
scheiterten, der offen war: der Server lief weiter und protokollierte, während der
Aufrufer "Verbindung verweigert" bekam. Die Ursache lag nicht im Server, sondern in
der Zahl, die er dem Betriebssystem für seine Warteschlange nennt -- und gefunden
wurde sie später als nötig, weil das Protokoll voller Tracebacks von Browsern stand,
die einfach weggegangen waren.
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
        """Geprüft wird die Zahl, die wirklich an ``listen()`` geht.

        Nicht das Klassenattribut: ``server_activate`` reicht es weiter, und nur was
        dort ankommt, sagt dem Betriebssystem, wie viele warten dürfen.
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
        # Fünf ist die Vorgabe von socketserver und der Grund, aus dem Windows abwies.
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
