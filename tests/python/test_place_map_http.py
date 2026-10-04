"""The map-image HTTP boundary reports safe reasons and preserves accepted bytes."""

import base64
import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.hosts.web import server
from quiltor.infrastructure.persistence.sqlite import place_map_images
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.request_timeout import REQUEST_TIMEOUT

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_PNG = REPO_ROOT / "distribution/assets/icons/icon.iconset/icon_128x128.png"
REAL_WEBP = REPO_ROOT / "packages/client/src/modules/manuscript/assets/paper-fiber-texture.webp"


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


def _jpeg(width: int, height: int) -> bytes:
    application_segment = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00" + b"\x00" * 9
    frame = (
        b"\xff\xc0"
        + (11).to_bytes(2, "big")
        + b"\x08"
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x01\x01\x11\x00"
    )
    return b"\xff\xd8" + application_segment + frame + b"\xff\xd9"


class PlaceMapHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment_patch = patch.dict(
            os.environ, {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": ""}
        )
        self.environment_patch.start()
        assistant_services = AssistantServices(MagicMock(), MagicMock())
        with patch(
            "quiltor.bootstrap.web.build_assistant_services",
            return_value=assistant_services,
        ):
            self.application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=_directories(Path(self.temp.name)),
            )
        self.application.prepare()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

        status, payload, _ = self._json_request(
            "POST", "/api/worlds/create", {"title": "Kartenprüfung", "backupUrl": ""}
        )
        self.assertEqual(status, 200)
        self.world_id = payload["world"]["id"]
        self.upload_path = f"/api/place-maps?world={self.world_id}"
        self.database = self.application.application.worlds.paths_for(
            self.world_id
        ).documents.database

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.application.close()
        self.environment_patch.stop()
        self.temp.cleanup()

    def _request(self, method: str, path: str, body: bytes = b"", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        connection.putrequest(method, path)
        for name, value in (headers or {}).items():
            connection.putheader(name, value)
        connection.endheaders(body)
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def _json_request(self, method: str, path: str, payload):
        body = json.dumps(payload).encode("utf-8")
        status, headers, raw = self._request(
            method,
            path,
            body,
            {"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        return status, json.loads(raw), headers

    def _assert_parser_rejection(
        self,
        *,
        expected_reason: str,
        transfer_encoding_present: bool = False,
        body=b"",
        headers=None,
    ):
        with patch.object(self.application.observability.logger, "event") as event:
            status, _, raw = self._request("POST", self.upload_path, body, headers)

        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "request.invalid")
        event.assert_called_once_with(
            "error",
            "http.request_failed",
            method="POST",
            route="/api/place-maps",
            error_type="RequestBodyRejected",
            reason=expected_reason,
            transfer_encoding_present=transfer_encoding_present,
        )
        return event

    def test_parser_rejections_have_safe_specific_reason_buckets(self):
        cases = (
            (
                "missing_length",
                True,
                b"",
                {"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
            ),
            (
                "invalid_length",
                False,
                b"",
                {"Content-Type": "application/json", "Content-Length": "private-raw-value"},
            ),
            (
                "too_large",
                False,
                b"",
                {
                    "Content-Type": "application/json",
                    "Content-Length": str(server.MAX_BODY + 1),
                },
            ),
            (
                "content_type",
                False,
                b"{}",
                {"Content-Type": "text/plain", "Content-Length": "2"},
            ),
            (
                "utf8",
                False,
                b"\xff",
                {"Content-Type": "application/json", "Content-Length": "1"},
            ),
            (
                "json",
                False,
                b"{",
                {"Content-Type": "application/json", "Content-Length": "1"},
            ),
        )

        for reason, transfer_encoding_present, body, headers in cases:
            with self.subTest(reason=reason):
                event = self._assert_parser_rejection(
                    expected_reason=reason,
                    transfer_encoding_present=transfer_encoding_present,
                    body=body,
                    headers=headers,
                )
                self.assertNotIn("private-raw-value", repr(event.call_args_list))

        self.assertEqual(place_map_images.catalog(db_path=self.database), [])

    def test_png_jpeg_and_webp_round_trip_without_byte_changes(self):
        images = (
            ("image/png", REAL_PNG.read_bytes()),
            ("image/jpeg", _jpeg(320, 180)),
            ("image/webp", REAL_WEBP.read_bytes()),
        )

        for expected_mime, content in images:
            with self.subTest(mime=expected_mime):
                status, stored, _ = self._json_request(
                    "POST",
                    self.upload_path,
                    {"data": base64.b64encode(content).decode("ascii")},
                )
                self.assertEqual(status, 201)
                self.assertEqual(stored["mime"], expected_mime)
                self.assertEqual(stored["byteSize"], len(content))

                status, headers, round_trip = self._request(
                    "GET",
                    f"/api/place-map?world={self.world_id}&id={stored['id']}",
                )
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], expected_mime)
                self.assertEqual(round_trip, content)

        self.assertEqual(len(place_map_images.catalog(db_path=self.database)), len(images))

    def test_handled_upload_rejections_are_logged_without_user_data(self):
        cases = (
            ([], "place_map.invalid_request"),
            ({"data": "%%%"}, "place_map.invalid_encoding"),
            (
                {"data": base64.b64encode(b"GIF89a" + b"private-image-data").decode("ascii")},
                "place_map.image_rejected",
            ),
        )

        for payload, expected_code in cases:
            with self.subTest(code=expected_code):
                with patch.object(self.application.observability.logger, "event") as event:
                    status, response, _ = self._json_request("POST", self.upload_path, payload)
                self.assertEqual(status, 400)
                self.assertEqual(response["error"]["code"], expected_code)
                event.assert_called_once_with(
                    "warning",
                    "place_map.upload_rejected",
                    error_code=expected_code,
                )
                rendered_event = repr(event.call_args_list)
                self.assertNotIn(self.world_id, rendered_event)
                self.assertNotIn("private-image-data", rendered_event)

        self.assertEqual(place_map_images.catalog(db_path=self.database), [])


if __name__ == "__main__":
    unittest.main()
