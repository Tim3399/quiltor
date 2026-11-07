"""Opening the example world as a preview, server side (T-214-5a, D-127, plan §11.4).

A preview is a real world file marked `preview_created_at`: hidden from the list, opened by
its id, filled without becoming real. The first change a route writes makes it a real world,
in the same transaction; it keeps `origin: "example"` for good and sorts after the author's
own worlds. Unchanged, it is discarded when its tab leaves, at the latest after a day.
"""

from __future__ import annotations

import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

from quiltor.application.worlds.example import ExampleWorldFailed
from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.hosts.web import server
from quiltor.infrastructure.persistence.sqlite import config, world_catalog
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.request_timeout import REQUEST_TIMEOUT

TITLE_DE = "Der gläserne Atlas"
TITLE_EN = "The Glass Atlas"


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


class _Server:
    """A local Quiltor on a free port with its own data directory."""

    def __init__(self, root: Path) -> None:
        with patch(
            "quiltor.bootstrap.web.build_assistant_services",
            return_value=AssistantServices(MagicMock(), MagicMock()),
        ):
            self.application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=_directories(root),
            )
        self.application.prepare()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.application.close()

    def request(self, method: str, path: str, payload=None, headers=None):
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        connection.putrequest(method, path)
        sent = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        sent.update(headers or {})
        for name, value in sent.items():
            connection.putheader(name, value)
        connection.endheaders(body)
        response = connection.getresponse()
        raw = response.read()
        result = (response.status, dict(response.getheaders()), raw)
        connection.close()
        return result

    def json(
        self, method: str, path: str, payload=None, headers=None
    ) -> tuple[int, Any, dict[str, str]]:
        status, response_headers, raw = self.request(method, path, payload, headers)
        return status, json.loads(raw) if raw else None, response_headers


class ExampleWorldPreviewRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        environment = patch.dict(
            os.environ, {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": ""}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.server = _Server(self.root)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.server.close)
        self.paths = config.SQLitePaths.from_data_directory(self.root)

    # ------------------------------------------------------------------ helpers
    def _open_example(self, lang: object = "de"):
        status, payload, _ = self.server.json("POST", "/api/worlds/open-example", {"lang": lang})
        self.assertEqual(status, 200, payload)
        return payload["world"]

    def _list(self):
        status, payload, _ = self.server.json("GET", "/api/worlds")
        self.assertEqual(status, 200)
        return payload["worlds"]

    def _open(self, world_id):
        return self.server.json("POST", "/api/worlds/open", {"id": world_id})

    def _manuscript(self, world_id):
        status, envelope, headers = self.server.json("GET", f"/api/manuscript?world={world_id}")
        self.assertEqual(status, 200, envelope)
        return envelope, headers["ETag"].strip('"')

    def _change_manuscript(self, world_id, *, if_match=None):
        envelope, etag = self._manuscript(world_id)
        envelope["payload"]["chapters"][0]["body"] += " Ein neuer Satz."
        if if_match is not None:
            envelope["revision"] = if_match
        return self.server.json(
            "POST",
            f"/api/manuscript?world={world_id}",
            envelope,
            {"If-Match": f'"{if_match if if_match is not None else etag}"'},
        )

    def _world_files(self, world_id):
        return [
            path
            for path in (
                self.paths.worlds / f"{world_id}.sqlite3",
                self.paths.data / "manuscripts" / world_id,
                self.paths.data / "profiles" / world_id,
                self.paths.data / "history" / world_id,
                self.paths.data / "backups" / world_id,
            )
            if path.exists()
        ]

    def _create(self, title):
        status, payload, _ = self.server.json(
            "POST", "/api/worlds/create", {"title": title, "backupUrl": ""}
        )
        self.assertEqual(status, 200, payload)
        return payload["world"]

    # ------------------------------------------------------------------ the preview
    def test_a_preview_is_not_listed_but_opens_and_says_it_is_one(self):
        world = self._open_example()
        self.assertTrue(world["preview"])
        self.assertEqual(world["origin"], "example")
        self.assertEqual(world["title"], TITLE_DE)
        self.assertEqual(self._list(), [])
        status, trash, _ = self.server.json("GET", "/api/worlds/trash")
        self.assertEqual((status, trash["worlds"]), (200, []))
        # Opening it again later -- a reload -- still says preview, so the bar stays.
        status, opened, _ = self._open(world["id"])
        self.assertEqual(status, 200, opened)
        self.assertTrue(opened["world"]["preview"])

    def test_the_preview_is_filled_without_becoming_real(self):
        world = self._open_example()
        envelope, revision = self._manuscript(world["id"])
        self.assertEqual(revision, "1")
        self.assertIn("Morgen", envelope["payload"]["chapters"][0]["body"])
        status, figures, _ = self.server.json("GET", f"/api/state?world={world['id']}")
        self.assertEqual(status, 200)
        names = {node["name"] for node in figures["payload"]["nodes"]}
        self.assertTrue({"Mara Venn", "Ada"} <= names, names)
        self.assertFalse(any(node["id"].startswith("x-") for node in figures["payload"]["nodes"]))
        ship = Path(__file__).resolve().parents[2] / "src/quiltor/resources/example_world/de.json"
        map_id = json.loads(ship.read_text(encoding="utf-8"))["mapImage"]["id"]
        self.assertIn(map_id, json.dumps(figures["payload"]))
        status, _, image = self.server.request(
            "GET", f"/api/place-map?world={world['id']}&id={map_id}"
        )
        self.assertEqual((status, image[:4]), (200, b"\x89PNG"))
        # Filling it kept no backup: a preview never gets one.
        self.assertFalse((self.paths.data / "backups" / world["id"]).exists())

    def test_the_interface_language_picks_the_world_and_anything_else_is_german(self):
        self.assertEqual(self._open_example("en")["title"], TITLE_EN)
        self.assertEqual(self._open_example("fr")["title"], TITLE_DE)
        self.assertEqual(self._open_example(None)["title"], TITLE_DE)

    def test_every_call_makes_a_fresh_preview(self):
        first, second = self._open_example(), self._open_example()
        self.assertNotEqual(first["id"], second["id"])

    # ------------------------------------------------------------------ becoming real
    def test_the_first_saved_change_makes_it_a_real_world(self):
        world = self._open_example()
        status, saved, _ = self._change_manuscript(world["id"])
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["world"]["id"], world["id"])
        self.assertNotIn("preview", saved["world"])
        self.assertEqual(saved["world"]["origin"], "example")
        listed = self._list()
        self.assertEqual(
            [(w["id"], w["title"], w["origin"]) for w in listed],
            [(world["id"], TITLE_DE, "example")],
        )
        status, opened, _ = self._open(world["id"])
        self.assertNotIn("preview", opened["world"])
        # A second save says nothing more about the world.
        status, again, _ = self._change_manuscript(world["id"])
        self.assertEqual(status, 200)
        self.assertNotIn("world", again)

    def test_a_conflicting_save_leaves_it_a_preview(self):
        world = self._open_example()
        status, refused, _ = self._change_manuscript(world["id"], if_match=7)
        self.assertEqual(status, 409, refused)
        self.assertEqual(self._list(), [])
        self.assertTrue(self._open(world["id"])[1]["world"]["preview"])

    def test_reading_and_exporting_leave_it_a_preview(self):
        world = self._open_example()
        status, _, _ = self.server.request(
            "POST", f"/api/manuscript-export/preview?world={world['id']}", {"preset": "editor"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self._list(), [])

    def test_a_map_the_author_uploads_makes_it_real(self):
        world = self._open_example()
        png = (
            Path(__file__).resolve().parents[2]
            / "src/quiltor/resources/example_world/harbour-map.png"
        ).read_bytes()
        import base64

        status, _, raw = self.server.request(
            "POST", f"/api/place-maps?world={world['id']}", {"data": base64.b64encode(png).decode()}
        )
        self.assertEqual(status, 201, raw)
        self.assertEqual([w["id"] for w in self._list()], [world["id"]])

    def test_a_second_world_of_the_same_name_gets_a_number_and_the_trash_counts(self):
        trashed = self._create(TITLE_DE)
        self.server.json("POST", "/api/worlds/delete", {"id": trashed["id"]})
        first, second = self._open_example(), self._open_example()
        self.assertEqual(
            self._change_manuscript(first["id"])[1]["world"]["title"], f"{TITLE_DE} (2)"
        )
        self.assertEqual(
            self._change_manuscript(second["id"])[1]["world"]["title"], f"{TITLE_DE} (3)"
        )
        self.assertEqual(
            sorted(w["title"] for w in self._list()), [f"{TITLE_DE} (2)", f"{TITLE_DE} (3)"]
        )

    def test_the_origin_stays_through_trash_and_restore(self):
        world = self._open_example()
        self._change_manuscript(world["id"])
        self.server.json("POST", "/api/worlds/delete", {"id": world["id"]})
        self.server.json("POST", "/api/worlds/restore", {"id": world["id"]})
        self.assertEqual(self._list()[0]["origin"], "example")

    def test_the_example_worlds_come_after_the_authors_own(self):
        with patch.object(world_catalog.uuid, "uuid4", return_value=SimpleNamespace(hex="0" * 32)):
            example = self._open_example()
        self._change_manuscript(example["id"])
        with patch.object(world_catalog.uuid, "uuid4", return_value=SimpleNamespace(hex="f" * 32)):
            own = self._create("Nordhafen")
        # By file name the example world would come first; the list puts it last.
        self.assertEqual([w["id"] for w in self._list()], [own["id"], example["id"]])

    # ------------------------------------------------------------------ leaving it
    def test_leaving_an_unchanged_preview_leaves_no_trace(self):
        world = self._open_example()
        self.assertTrue(self._world_files(world["id"]))
        status, answer, _ = self.server.json(
            "POST", "/api/worlds/discard-preview", {"id": world["id"]}
        )
        self.assertEqual((status, answer["discarded"]), (200, True))
        self.assertEqual(self._world_files(world["id"]), [])
        self.assertEqual(self._list(), [])
        self.assertEqual(self._open(world["id"])[0], 404)

    def test_leaving_a_changed_world_keeps_it(self):
        world = self._open_example()
        self._change_manuscript(world["id"])
        status, answer, _ = self.server.json(
            "POST", "/api/worlds/discard-preview", {"id": world["id"]}
        )
        self.assertEqual((status, answer["discarded"]), (200, False))
        self.assertEqual([w["id"] for w in self._list()], [world["id"]])

    def test_the_beacon_is_json_and_is_answered(self):
        # navigator.sendBeacon with a JSON blob; a text/plain beacon would be refused (F-214-11).
        world = self._open_example()
        body = json.dumps({"id": world["id"]})
        status, _, _ = self.server.request(
            "POST", "/api/worlds/discard-preview", None, {"Content-Length": "0"}
        )
        self.assertNotEqual(status, 500)
        status, _, raw = self.server.request(
            "POST",
            "/api/worlds/discard-preview",
            json.loads(body),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200, raw)
        status, _, _ = self.server.request(
            "POST",
            "/api/worlds/discard-preview",
            json.loads(body),
            {"Content-Type": "text/plain"},
        )
        self.assertNotEqual(status, 200)

    def test_a_preview_older_than_a_day_is_cleaned_up_and_nothing_else(self):
        old_preview = self._open_example()
        young_preview = self._open_example()
        own = self._create("Alt und echt")
        long_ago = (datetime.now().astimezone() - timedelta(hours=25)).isoformat()
        for world_id in (old_preview["id"], own["id"]):
            path = self.paths.worlds / f"{world_id}.sqlite3"
            database = sqlite3.connect(path)
            try:
                with database:
                    database.execute(
                        "UPDATE meta SET value=? WHERE key=?", (long_ago, config.PREVIEW_KEY)
                    )
            finally:
                database.close()
        self._open_example()  # every call sweeps
        self.assertEqual(self._world_files(old_preview["id"]), [])
        self.assertTrue(self._world_files(young_preview["id"]))
        self.assertEqual([w["id"] for w in self._list()], [own["id"]])

    # ------------------------------------------------------------------ never synced, never backed up
    def test_sync_and_backups_refuse_a_preview(self):
        world = self._open_example()
        for method, path, payload in (
            ("POST", f"/api/sync/target?world={world['id']}", {"backupUrl": ""}),
            ("POST", "/api/sync", {"worldId": world["id"], "action": "sync"}),
            ("POST", "/api/backup", {"worldId": world["id"], "message": "Stand"}),
        ):
            with self.subTest(route=path):
                status, answer, _ = self.server.json(method, path, payload)
                self.assertEqual(status, 409, answer)
                self.assertEqual(answer["error"]["code"], "world.preview")
        self.assertFalse((self.paths.data / "history" / world["id"]).exists())
        self.assertEqual(self._list(), [])

    def test_a_broken_example_world_leaves_nothing_behind(self):
        services = self.server.application.application.example_worlds
        with (
            patch.object(services, "_source", side_effect=OSError("missing")),
            self.assertRaises(ExampleWorldFailed),
        ):
            services.open(config.LOCAL_OWNER, "de")
        good = services._source("de")
        broken = SimpleNamespace(
            document=dict(good.document, storyboards={"boards": "kaputt"}), map_image=good.map_image
        )
        with patch.object(services, "_source", return_value=broken):
            status, answer, _ = self.server.json("POST", "/api/worlds/open-example", {"lang": "de"})
        self.assertEqual((status, answer["error"]["code"]), (500, "world.example_failed"))
        self.assertEqual(list(self.paths.worlds.glob("*.sqlite3")), [])


class PreviewOwnershipTests(unittest.TestCase):
    """Hosted: every account has its own previews, and nobody else's are visible or removable."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        environment = patch.dict(
            os.environ, {"QUILTOR_HOST": "127.0.0.1", "QUILTOR_PUBLIC_URL": ""}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.server = _Server(root)
        self.addCleanup(self.server.close)
        services = self.server.application.application
        self.examples = services.example_worlds
        self.worlds = services.worlds
        self.documents = services.documents

    def _change(self, world_id):
        location = self.worlds.paths_for(world_id).documents
        manuscript = self.documents.load("manuscript", location.database)
        state = manuscript.state
        state["chapters"][0]["body"] += " Neu."
        self.documents.save("manuscript", state, manuscript.revision, location)
        return self.worlds.finish_promotion(world_id)

    def test_each_account_sees_and_names_only_its_own(self):
        ada = self.examples.open("sub-ada", "de")
        bela = self.examples.open("sub-bela", "de")
        self.assertEqual(self.worlds.list("sub-ada"), [])
        with self.assertRaises(PermissionError):
            self.worlds.open(ada["id"], "sub-bela")
        with self.assertRaises(PermissionError):
            self.worlds.discard_preview(ada["id"], "sub-bela")
        # Both become real without a number: the names are counted per account.
        self.assertEqual(self._change(ada["id"])["title"], TITLE_DE)
        self.assertEqual(self._change(bela["id"])["title"], TITLE_DE)
        self.assertEqual([w["id"] for w in self.worlds.list("sub-ada")], [ada["id"]])
        self.assertEqual([w["id"] for w in self.worlds.list("sub-bela")], [bela["id"]])

    def test_the_save_itself_makes_the_preview_real_in_its_transaction(self):
        # Without the route's finish_promotion: the document write alone ends the preview.
        world = self.examples.open("sub-ada", "de")
        location = self.worlds.paths_for(world["id"]).documents
        manuscript = self.documents.load("manuscript", location.database)
        self.documents.save("manuscript", manuscript.state, manuscript.revision, location)
        self.assertEqual([w["id"] for w in self.worlds.list("sub-ada")], [world["id"]])

    def test_an_internal_save_without_promotion_keeps_the_preview(self):
        world = self.examples.open("sub-ada", "de")
        location = self.worlds.paths_for(world["id"]).documents
        manuscript = self.documents.load("manuscript", location.database)
        self.documents.save(
            "manuscript", manuscript.state, manuscript.revision, location, promote=False
        )
        self.assertEqual(self.worlds.list("sub-ada"), [])

    def test_a_real_world_cannot_be_discarded_as_a_preview(self):
        own = self.worlds.create("Nordhafen", "", "sub-ada")
        with self.assertRaisesRegex(ValueError, "preview"):
            self.worlds.discard_preview(own["id"], "sub-ada")
        self.assertEqual([w["id"] for w in self.worlds.list("sub-ada")], [own["id"]])


class FreeTitleTests(unittest.TestCase):
    def test_numbers_start_at_two_and_skip_what_is_taken(self):
        self.assertEqual(world_catalog.free_title("Atlas", set()), "Atlas")
        self.assertEqual(world_catalog.free_title("Atlas", {"Atlas"}), "Atlas (2)")
        self.assertEqual(world_catalog.free_title("Atlas", {"Atlas", "Atlas (2)"}), "Atlas (3)")

    def test_a_long_title_keeps_its_number_within_the_limit(self):
        long = "A" * world_catalog.MAX_TITLE_LENGTH
        numbered = world_catalog.free_title(long, {long})
        self.assertEqual(len(numbered), world_catalog.MAX_TITLE_LENGTH)
        self.assertTrue(numbered.endswith(" (2)"))


if __name__ == "__main__":
    unittest.main()
