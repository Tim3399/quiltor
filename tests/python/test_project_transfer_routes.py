from __future__ import annotations

import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from quiltor.application.project_transfer import (
    MAX_ARCHIVE_BYTES,
    InvalidProjectArchive,
    ProjectArchiveLimitExceeded,
)
from quiltor.delivery.http import routes
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes.project_transfer import (
    export_project,
    import_project,
    preview_project,
)


class Handler:
    def __init__(self, body: bytes = b"") -> None:
        self.headers = {
            "Content-Type": "application/zip",
            "Content-Length": str(len(body)),
        }
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers = {}
        self.json = None

    def send_response(self, status: int) -> None:
        self.status = status

    def send_header(self, name: str, value: str) -> None:
        self.response_headers[name] = value

    def end_headers(self) -> None:
        pass

    def send_json(self, payload, code=200, headers=None) -> None:
        self.status = code
        self.json = payload

    def send_exception(self, error) -> None:
        raise error


class ProjectTransferRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = Mock()
        self.app = SimpleNamespace(project_transfer=self.service, lock=threading.Lock())
        self.session = SimpleNamespace(sub="alice")

    def test_preview_and_import_accept_raw_archives_for_the_session_owner(self):
        body = b"PK archive"
        self.service.preview.return_value = {"title": "Preview"}
        self.service.import_archive.return_value = {"id": "new-world"}

        preview_handler = Handler(body)
        preview_project(
            preview_handler,
            Request(path="/api/project-transfer/preview", session=self.session),
            self.app,
        )
        self.assertEqual(preview_handler.json, {"ok": True, "preview": {"title": "Preview"}})
        self.service.preview.assert_called_once_with(body)

        import_handler = Handler(body)
        import_project(
            import_handler,
            Request(path="/api/project-transfer/import", session=self.session),
            self.app,
        )
        self.assertEqual(import_handler.status, 201)
        self.assertEqual(import_handler.json, {"ok": True, "world": {"id": "new-world"}})
        self.service.import_archive.assert_called_once_with(body, "alice")

    def test_transfer_routes_are_registered_with_expected_methods(self):
        self.assertIn("/api/project-transfer/export", routes.GET)
        self.assertIn("/api/project-transfer/preview", routes.SAVE)
        self.assertIn("/api/project-transfer/import", routes.SAVE)

    def test_upload_boundary_rejects_bad_media_type_size_and_incomplete_body(self):
        invalid_media = Handler(b"archive")
        invalid_media.headers["Content-Type"] = "application/json"
        with self.assertRaises(InvalidProjectArchive):
            preview_project(
                invalid_media,
                Request(path="/api/project-transfer/preview", session=self.session),
                self.app,
            )

        too_large = Handler(b"archive")
        too_large.headers["Content-Length"] = str(MAX_ARCHIVE_BYTES + 1)
        with self.assertRaises(ProjectArchiveLimitExceeded):
            preview_project(
                too_large,
                Request(path="/api/project-transfer/preview", session=self.session),
                self.app,
            )

        incomplete = Handler(b"archive")
        incomplete.headers["Content-Length"] = str(len(b"archive") + 1)
        with self.assertRaises(InvalidProjectArchive):
            preview_project(
                incomplete,
                Request(path="/api/project-transfer/preview", session=self.session),
                self.app,
            )
        self.service.preview.assert_not_called()

    def test_export_is_owner_scoped_binary_zip_download(self):
        self.service.export.return_value = ("World", b"PK archive")
        handler = Handler()
        request = Request(
            path="/api/project-transfer/export",
            query={"world": ["world-id"]},
            session=self.session,
        )

        export_project(handler, request, self.app)

        self.service.export.assert_called_once_with("world-id", "alice")
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.response_headers["Content-Type"], "application/zip")
        self.assertEqual(handler.wfile.getvalue(), b"PK archive")


if __name__ == "__main__":
    unittest.main()
