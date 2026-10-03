from __future__ import annotations

import copy
import io
import json
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from quiltor.application.manuscript_export import (
    DOCX_MEDIA_TYPE,
    EmptyExportBook,
    ExportPreviewMismatch,
    ExportWarningsUnacknowledged,
    InvalidExportRequest,
    ManuscriptExportUseCases,
    word_count,
)
from quiltor.delivery.http import routes
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes.manuscript_export import (
    download_manuscript_docx,
    preview_manuscript_export,
)
from tests.python.test_server_auth import _LiveAuthServerTestCase


def manuscript():
    return {
        "chapters": [
            {"id": "second", "title": "2. Abend", "body": "Noch zwei Worte.", "note": "Notiz"},
            {"id": "first", "title": "1. Morgen", "body": "Hallo 🌊 Welt.", "note": ""},
            {
                "id": "aside",
                "title": "Reserve",
                "body": "Bleibt hier.",
                "note": "",
                "inBook": False,
            },
        ],
        "structure": {
            "folders": [{"id": "part", "title": "Erster Teil"}],
            "items": [
                {"id": "f", "kind": "folder", "folderId": "part", "position": 0},
                {
                    "id": "c1",
                    "kind": "chapter",
                    "chapterId": "first",
                    "parentFolderId": "part",
                    "position": 0,
                },
                {
                    "id": "c2",
                    "kind": "chapter",
                    "chapterId": "second",
                    "parentFolderId": "part",
                    "position": 1,
                },
                {"id": "c3", "kind": "chapter", "chapterId": "aside", "position": 1},
            ],
        },
    }


class ManuscriptExportUseCaseTests(unittest.TestCase):
    def setUp(self):
        self.state = manuscript()
        self.documents = Mock()
        self.documents.load.side_effect = lambda *_: copy.deepcopy(self.state)
        self.documents.revision.return_value = 8
        self.renderer = Mock(return_value=b"PK-docx")
        self.service = ManuscriptExportUseCases(self.documents, self.renderer)
        self.database = Path("owned.sqlite")

    def reviewed(self, preset="editor"):
        preview = self.service.preview(self.database, preset)
        return {
            "preset": preset,
            "revision": preview["revision"],
            "sourceSha256": preview["sourceSha256"],
            "acknowledgedWarnings": [warning["code"] for warning in preview["warnings"]],
        }

    def test_preview_counts_and_serializer_follow_included_binder_order_without_writes(self):
        before = copy.deepcopy(self.state)
        preview = self.service.preview(self.database, "editor")
        self.assertEqual([chapter["id"] for chapter in preview["chapters"]], ["first", "second"])
        self.assertEqual(
            preview["counts"],
            {
                "manuscriptChapters": 3,
                "manuscriptWords": 8,
                "exportedChapters": 2,
                "exportedWords": 6,
            },
        )
        self.assertEqual(
            preview["warnings"],
            [
                {"code": "notes", "count": 1},
                {"code": "folders", "count": 1},
                {"code": "excluded_chapters", "count": 1},
            ],
        )
        self.assertEqual([c["id"] for c in self.renderer.call_args.args[0]], ["first", "second"])
        self.assertEqual(self.state, before)
        self.documents.save.assert_not_called()

    def test_source_revision_digest_and_preset_cannot_drift_after_review(self):
        for changed in ("revision", "body", "preset", "note", "inclusion"):
            with self.subTest(changed=changed):
                self.setUp()
                payload = self.reviewed()
                if changed == "revision":
                    self.documents.revision.return_value = 9
                elif changed == "preset":
                    payload["preset"] = "normseite"
                elif changed == "inclusion":
                    self.state["chapters"][2]["inBook"] = True
                else:
                    self.state["chapters"][0][changed] += " geändert"
                self.renderer.reset_mock()
                with self.assertRaises(ExportPreviewMismatch):
                    self.service.export(self.database, payload)
                self.renderer.assert_not_called()

    def test_every_current_warning_must_be_acknowledged_and_export_is_read_only(self):
        payload = self.reviewed("normseite")
        omitted = {**payload, "acknowledgedWarnings": ["notes"]}
        with self.assertRaises(ExportWarningsUnacknowledged):
            self.service.export(self.database, omitted)
        self.assertEqual(
            self.service.export(self.database, payload), ("Quiltor-Normseite.docx", b"PK-docx")
        )
        self.documents.save.assert_not_called()

    def test_empty_book_and_unknown_extension_data_are_explicit(self):
        self.state["customManuscript"] = {"secret": "not document text"}
        self.state["chapters"][0]["customChapter"] = "extra"
        preview = self.service.preview(self.database, "editor")
        self.assertIn({"code": "extensions", "count": 2}, preview["warnings"])
        for chapter in self.state["chapters"]:
            chapter["inBook"] = False
        with self.assertRaises(EmptyExportBook):
            self.service.preview(self.database, "editor")

    def test_word_counts_match_ecmascript_whitespace_including_bom(self):
        self.assertEqual(word_count(" a\ufeffb\u00a0c\u0085d \t🌊 "), 4)

    def test_export_consumes_canonical_wire_offsets_from_legacy_persistence(self):
        from quiltor.infrastructure.exporting.docx import serialize_docx

        self.state["chapters"][0]["marks"] = [{"from": 0.0, "to": 1.0, "kind": "bold"}]
        self.service.preview(self.database, "editor")
        chapters = self.renderer.call_args.args[0]
        self.assertIs(type(chapters[1]["marks"][0]["from"]), int)
        self.assertTrue(serialize_docx(chapters).content.startswith(b"PK"))


class Handler:
    def __init__(self, payload):
        self.payload = payload
        self.headers = {}
        self.wfile = io.BytesIO()
        self.json = None
        self.status = None

    def _read_json_body(self):
        return self.payload

    def send_json(self, payload):
        self.json = payload

    def send_response(self, code):
        self.status = code

    def send_header(self, name, value):
        self.headers[name] = value

    def end_headers(self):
        pass


class ManuscriptExportRouteTests(unittest.TestCase):
    def setUp(self):
        self.service = Mock()
        self.app = SimpleNamespace(manuscript_export=self.service, lock=threading.Lock())
        self.request = Request(
            "/api/manuscript-export/preview", world=SimpleNamespace(db_path=Path("owned.sqlite"))
        )

    def test_both_routes_require_resolved_authenticated_world(self):
        for suffix in ("preview", "docx"):
            registration = routes.SAVE[f"/api/manuscript-export/{suffix}"]
            self.assertTrue(registration.world)
            self.assertFalse(registration.anonymous)
        handler = Handler({"preset": "editor"})
        self.service.preview.return_value = {"preset": "editor"}
        preview_manuscript_export(handler, self.request, self.app)
        self.service.preview.assert_called_once_with(Path("owned.sqlite"), "editor")
        self.assertEqual(handler.json, {"ok": True, "preview": {"preset": "editor"}})

    def test_strict_requests_reject_wrong_shapes_before_service(self):
        valid = {
            "preset": "editor",
            "revision": 1,
            "sourceSha256": "a" * 64,
            "acknowledgedWarnings": [],
        }
        invalid = [
            None,
            [],
            {},
            {**valid, "preset": "unknown"},
            {**valid, "revision": True},
            {**valid, "revision": -1},
            {**valid, "revision": 9007199254740992},
            {**valid, "sourceSha256": "not a digest"},
            {**valid, "acknowledgedWarnings": [None]},
            {**valid, "acknowledgedWarnings": ["notes", "notes"]},
            {**valid, "unexpected": 1},
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(InvalidExportRequest):
                download_manuscript_docx(Handler(payload), self.request, self.app)
        self.service.export.assert_not_called()

    def test_docx_response_uses_binary_mime_safe_fixed_filename_and_no_cache(self):
        payload = {
            "preset": "editor",
            "revision": 1,
            "sourceSha256": "a" * 64,
            "acknowledgedWarnings": [],
        }
        handler = Handler(payload)
        self.service.export.return_value = ("Quiltor-Manuskript.docx", b"PK\x03\x04")
        download_manuscript_docx(handler, self.request, self.app)
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.headers["Content-Type"], DOCX_MEDIA_TYPE)
        self.assertEqual(handler.headers["Cache-Control"], "no-store")
        self.assertEqual(handler.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(handler.headers["Content-Length"], "4")
        self.assertEqual(handler.wfile.getvalue(), b"PK\x03\x04")


class ManuscriptExportAuthorizationTests(_LiveAuthServerTestCase):
    def test_preview_and_download_are_owner_scoped_and_read_only(self):
        from quiltor.infrastructure.importing.docx import parse_docx

        alice = {"quiltor_session": self._login("alice")}
        bob = {"quiltor_session": self._login("bob")}
        status, _, raw, _ = self._request(
            "POST", "/api/worlds/create", {"title": "Exportprüfung"}, cookies=alice
        )
        self.assertEqual(status, 200)
        world = json.loads(raw)["world"]["id"]
        path = f"/api/manuscript?world={world}"
        status, _, raw, _ = self._request("GET", path, cookies=alice)
        original = json.loads(raw)
        original["payload"] = manuscript()
        status, _, _, _ = self._request("PUT", path, original, cookies=alice)
        self.assertEqual(status, 200)
        _, _, before, _ = self._request("GET", path, cookies=alice)
        for suffix in ("preview", "docx"):
            target = f"/api/manuscript-export/{suffix}?world={world}"
            for cookies, expected in ((None, 401), (bob, 403)):
                status, _, _, _ = self._request(
                    "POST", target, {"preset": "editor"}, cookies=cookies
                )
                self.assertEqual(status, expected)
        target = f"/api/manuscript-export/preview?world={world}"
        status, _, raw, _ = self._request("POST", target, {"preset": "editor"}, cookies=alice)
        self.assertEqual(status, 200, raw)
        preview = json.loads(raw)["preview"]
        payload = {key: preview[key] for key in ("preset", "revision", "sourceSha256")}
        payload["acknowledgedWarnings"] = [warning["code"] for warning in preview["warnings"]]
        target = f"/api/manuscript-export/docx?world={world}"
        status, headers, raw, _ = self._request("POST", target, payload, cookies=alice)
        self.assertEqual(status, 200, raw[:200])
        self.assertEqual(headers["Content-Type"], DOCX_MEDIA_TYPE)
        parsed = parse_docx("Export.docx", raw)
        self.assertEqual([chapter.title for chapter in parsed.chapters], ["1. Morgen", "2. Abend"])
        _, _, after, _ = self._request("GET", path, cookies=alice)
        self.assertEqual(json.loads(after), json.loads(before))
