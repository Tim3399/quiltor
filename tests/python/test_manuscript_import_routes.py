from __future__ import annotations

import base64
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from quiltor.application.manuscript_import import InvalidManuscriptFile, ManuscriptLimitExceeded
from quiltor.delivery.http import routes
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes.manuscript_import import (
    import_manuscript,
    import_manuscript_v2,
    preview_manuscript,
    preview_manuscript_v2,
)


class Handler:
    def __init__(self, payload):
        self.payload = payload
        self.status = None
        self.json = None

    def _read_json_body(self):
        return self.payload

    def send_json(self, payload, code=200, headers=None):
        self.status = code
        self.json = payload


class ManuscriptImportRouteTests(unittest.TestCase):
    def setUp(self):
        self.service = Mock()
        self.app = SimpleNamespace(manuscript_import=self.service, lock=threading.Lock())
        self.request = Request(
            path="/api/manuscript-import/preview", session=SimpleNamespace(sub="alice")
        )

    def test_routes_are_registered_and_preview_decodes_bounded_base64(self):
        self.assertIn("/api/manuscript-import/preview", routes.SAVE)
        self.assertIn("/api/manuscript-import/import", routes.SAVE)
        self.assertIn("/api/manuscript-import/v2/preview", routes.SAVE)
        self.assertIn("/api/manuscript-import/v2/import", routes.SAVE)
        self.service.preview.return_value = {"format": "docx"}
        handler = Handler(
            {"fileName": "Roman.docx", "dataBase64": base64.b64encode(b"PK").decode()}
        )
        preview_manuscript(handler, self.request, self.app)
        self.service.preview.assert_called_once_with("Roman.docx", b"PK", None)
        self.assertEqual(handler.json, {"ok": True, "preview": {"format": "docx"}})
        with self.assertRaises(InvalidManuscriptFile):
            preview_manuscript(
                Handler({"fileName": "Roman.docx", "dataBase64": "%%%"}),
                self.request,
                self.app,
            )

    def test_import_forwards_owner_and_returns_created_world(self):
        self.service.publish.return_value = {"id": "world"}
        payload = {
            "fileName": "Roman.docx",
            "dataBase64": base64.b64encode(b"PK").decode(),
            "sourceSha256": "a" * 64,
            "title": "Roman",
            "chapters": [{"sourceIndexes": [0], "title": "Kapitel"}],
            "acknowledgedWarnings": [],
            "requestId": "014e8d4c-0dc7-4e7a-8854-e8f4c9ddc828",
        }
        handler = Handler(payload)
        import_manuscript(handler, self.request, self.app)
        self.assertEqual(handler.status, 201)
        self.assertEqual(handler.json, {"ok": True, "world": {"id": "world"}})
        self.assertEqual(self.service.publish.call_args.args[-1], "alice")

    def test_encoded_payload_larger_than_decoded_limit_is_rejected_before_decode(self):
        from quiltor.application.manuscript_import import MAX_DOCX_BYTES

        handler = Handler({"fileName": "large.docx", "dataBase64": "A" * (MAX_DOCX_BYTES * 2)})
        with self.assertRaises(ManuscriptLimitExceeded):
            preview_manuscript(handler, self.request, self.app)
        self.service.preview.assert_not_called()

    def test_v2_routes_keep_the_strict_envelope_and_forward_owner(self):
        self.service.preview_v2.return_value = {"format": "txt", "units": []}
        preview_handler = Handler(
            {"fileName": "Roman.txt", "dataBase64": base64.b64encode(b"Text").decode()}
        )
        preview_manuscript_v2(preview_handler, self.request, self.app)
        self.service.preview_v2.assert_called_once_with("Roman.txt", b"Text", None)
        payload = {
            "fileName": "Roman.txt",
            "dataBase64": base64.b64encode(b"Text").decode(),
            "sourceSha256": "a" * 64,
            "title": "Roman",
            "chapters": [{"sourceIndexes": [0], "title": "Text", "folderPath": []}],
            "acknowledgedWarnings": [],
            "requestId": "014e8d4c-0dc7-4e7a-8854-e8f4c9ddc828",
        }
        self.service.publish_v2.return_value = {"id": "world-v2"}
        import_handler = Handler(payload)
        import_manuscript_v2(import_handler, self.request, self.app)
        self.assertEqual(import_handler.status, 201)
        self.assertEqual(self.service.publish_v2.call_args.args[-1], "alice")


if __name__ == "__main__":
    unittest.main()
