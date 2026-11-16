"""T-268 audit, package D2: inputs and files (area 3).

Gaps are pinned with ``expectedFailure`` and the finding id S268-1xx from
implementer/T-268-audit-input-ai.md; phase 4 turns them green. The other tests
pin what was checked and found sound.
"""

import io
import json
import unittest
import zipfile
from unittest.mock import patch

from quiltor.application.manuscript_import.errors import InvalidManuscriptFile
from quiltor.domain.story_world.place_map_image import UnsupportedImage, identify
from quiltor.hosts.web import server
from quiltor.infrastructure.importing.docx import parse_docx
from tests.python.test_server_auth import _LiveAuthServerTestCase

DOCUMENT = (
    b'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
    b'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hafen</w:t></w:r></w:p>'
    b"</w:body></w:document>"
)


def _docx(document: bytes, *, declared_size: int | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document)
    payload = buffer.getvalue()
    if declared_size is None:
        return payload
    # Rewrite the uncompressed size in the local header and the central directory,
    # so the member claims to be smaller than it is.
    original = len(document).to_bytes(4, "little")
    lie = declared_size.to_bytes(4, "little")
    return payload.replace(original, lie)


class DocxImportTests(unittest.TestCase):
    """3.1: checked, no finding."""

    def test_entity_declarations_are_refused(self):
        bomb = (
            b'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa">'
            b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><d>&b;</d>'
        )
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx("bombe.docx", _docx(bomb))

    def test_utf16_doctype_is_refused_too(self):
        bomb = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE d [<!ENTITY a "x">]><d/>'
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx("bombe.docx", _docx(bomb.encode("utf-16")))

    def test_member_lying_about_its_size_is_cut_at_the_declared_size(self):
        payload = _docx(DOCUMENT, declared_size=20)
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx("luege.docx", payload)


class PlaceMapImageTests(unittest.TestCase):
    """3.3: checked, no finding."""

    def test_svg_is_not_an_accepted_map_image(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        with self.assertRaises(UnsupportedImage):
            identify(svg)


class BodyReadingTests(_LiveAuthServerTestCase):
    def _world(self, session: str) -> str:
        status, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Welt", "backupUrl": ""},
            cookies={"quiltor_session": session},
        )
        self.assertEqual(status, 200, body)
        return json.loads(body)["world"]["id"]

    # S268-101: _read_json_body (hosts/web/server.py:454-456) maps only
    # JSONDecodeError to 400. Deeply nested JSON raises RecursionError, which falls
    # through to 500 (delivery/http/errors.py:139).
    @unittest.expectedFailure
    def test_deeply_nested_json_is_a_400_not_a_500(self):
        session = self._login("user-nested")
        world = self._world(session)
        conn_body = b"[" * 200_000 + b"]" * 200_000
        import http.client

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request(
            "POST",
            f"/api/state?world={world}",
            body=conn_body,
            headers={
                "Content-Type": "application/json",
                "Cookie": f"quiltor_session={session}",
            },
        )
        status = conn.getresponse().status
        conn.close()
        self.assertEqual(status, 400)

    # S268-102: parse_request (hosts/web/server.py:300-305) clears the socket
    # timeout once the headers are read, so read_request_body (:516-518) waits
    # without limit for a body that never comes. Each such request holds one
    # thread (ThreadingTCPServer, daemon_threads, :1082-1094). The test records
    # the timeout in effect while the body is read.
    def test_body_is_read_with_a_socket_timeout(self):
        session = self._login("user-slow")
        world = self._world(session)
        seen: list[float | None] = []
        original = server.Handler.read_request_body

        def recording(handler, length):
            seen.append(handler.connection.gettimeout())
            return original(handler, length)

        with patch.object(server.Handler, "read_request_body", recording):
            _status, _, body, _ = self._request(
                "POST",
                f"/api/state?world={world}",
                body={"elements": []},
                cookies={"quiltor_session": session},
            )
        self.assertTrue(seen, body)
        self.assertIsNotNone(seen[0])


if __name__ == "__main__":
    unittest.main()
