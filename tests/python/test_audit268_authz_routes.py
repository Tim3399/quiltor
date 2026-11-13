"""T-268 audit D1: who may do what (checklist 2.1-2.3, 2.6-2.9).

Two accounts on one hosted server; every route is driven with the second account
against the first one's world. Gap tests are `@unittest.expectedFailure` and name S268-<n>.
"""

from __future__ import annotations

import json
import unittest

from quiltor.delivery.http import routes as api_routes
from quiltor.infrastructure.backup.authorization import EndpointBoundBackupAuthorizer
from quiltor.infrastructure.persistence.sqlite import restore
from tests.python.test_audit268_identity_support import SESSION_COOKIE, HostedHarness

api_routes.load()

# The route table as audited on int/T-61 7fcf7993. A new route has to be classified here.
GET_WITHOUT_WORLD = {
    "/api/assistant/install/status",
    "/api/backup/login",
    "/api/backup/remote",
    "/api/capabilities",
    "/api/diagnostics",
    "/api/project-transfer/export",
    "/api/version",
    "/api/whoami",
    "/api/worlds",
    "/api/worlds/trash",
    "/api/writing-assistance/status",
    "/auth/callback",
    "/backup/callback",
    "/login",
}
# Routes without `world=True` that name a world themselves (body `worldId` or `id`/`world`).
SAVE_NAMING_A_WORLD = {
    "/api/assistant/job/cancel",
    "/api/assistant/jobs",
    "/api/backup",
    "/api/backups/restore",
    "/api/book.pdf",
    "/api/sync",
    "/api/worlds/open",
    "/api/worlds/delete",
    "/api/worlds/restore",
    "/api/worlds/purge",
    "/api/worlds/discard-preview",
}
SAVE_WITHOUT_WORLD_ID = {
    "/api/assistant/install",
    "/api/backup/login",
    "/api/backup/logout",
    "/api/backup/restore",
    "/api/manuscript-import/import",
    "/api/manuscript-import/preview",
    "/api/manuscript-import/v2/import",
    "/api/manuscript-import/v2/preview",
    "/api/project-transfer/import",
    "/api/project-transfer/preview",
    "/api/worlds/create",
    "/api/worlds/open-example",
    "/api/writing-assistance/check",
    "/api/writing-assistance/grammar/install",
    "/api/writing-assistance/install",
    "/api/writing-assistance/lookup",
    "/logout",
}


class RouteTableTests(unittest.TestCase):
    """2.1"""

    def test_every_route_is_classified(self) -> None:
        get_without = {p for p, r in api_routes.GET.items() if not r.world}
        self.assertEqual(get_without, GET_WITHOUT_WORLD)
        save_without = {p for p, r in api_routes.SAVE.items() if not r.world}
        self.assertEqual(save_without, SAVE_NAMING_A_WORLD | SAVE_WITHOUT_WORLD_ID)

    def test_only_the_login_flow_and_the_version_probe_are_anonymous(self) -> None:
        anonymous = {
            p for t in (api_routes.GET, api_routes.SAVE) for p, r in t.items() if r.anonymous
        }
        self.assertEqual(anonymous, {"/api/version", "/login", "/auth/callback", "/logout"})

    def test_installing_and_device_sync_are_flagged_where_they_happen(self) -> None:
        operator = {
            p for t in (api_routes.GET, api_routes.SAVE) for p, r in t.items() if r.operator_only
        }
        self.assertEqual(
            operator,
            {
                "/api/assistant/install",
                "/api/writing-assistance/install",
                "/api/writing-assistance/grammar/install",
            },
        )
        sync = {p for t in (api_routes.GET, api_routes.SAVE) for p, r in t.items() if r.device_sync}
        self.assertEqual(
            sync,
            {
                "/api/backup/login",
                "/api/backup/remote",
                "/api/backup/logout",
                "/api/backup/restore",
                "/backup/callback",
                "/api/sync",
                "/api/sync/preview",
                "/api/sync/target",
            },
        )


class TwoAccountsTests(HostedHarness):
    def setUp(self) -> None:
        super().setUp()
        self.alice = self.login("alice", roles=("premium",))
        self.bob = self.login("bob", roles=("premium",))
        self.alices_world = self.create_world(self.alice, "Alices Welt")
        self.bobs_world = self.create_world(self.bob, "Bobs Welt")

    def as_bob(self, method: str, path: str, body=None, **kwargs):
        return self.json_request(method, path, body, cookies={SESSION_COOKIE: self.bob}, **kwargs)

    def alices_manuscript(self):
        return self.json_request(
            "GET",
            f"/api/manuscript?world={self.alices_world}",
            cookies={SESSION_COOKIE: self.alice},
        )[1]


class WorldIsolationTests(TwoAccountsTests):
    """2.2"""

    def test_every_world_scoped_read_refuses_another_accounts_world(self) -> None:
        checked = 0
        for path, registration in sorted(api_routes.GET.items()):
            if not registration.world:
                continue
            with self.subTest(path=path):
                status, document, _, _ = self.as_bob("GET", f"{path}?world={self.alices_world}")
                self.assertEqual(status, 403)
                self.assertNotIn("Alices Welt", json.dumps(document))
                checked += 1
        self.assertGreaterEqual(checked, 15)

    def test_every_world_scoped_write_refuses_another_accounts_world(self) -> None:
        before = self.alices_manuscript()
        for path, registration in sorted(api_routes.SAVE.items()):
            if (
                not (registration.world or path in SAVE_NAMING_A_WORLD)
                or registration.operator_only
            ):
                continue
            if path in {"/api/worlds/open"}:
                continue
            with self.subTest(path=path):
                status, document, _, _ = self.as_bob(
                    "POST",
                    f"{path}?world={self.alices_world}",
                    {
                        "worldId": self.alices_world,
                        "id": self.alices_world,
                        "question": "Q",
                        "name": "backup-x.sqlite3",
                        "message": "m",
                        "preset": "editor",
                    },
                    headers={"Idempotency-Key": "k"},
                )
                self.assertIn(status, (400, 403, 409), (path, document))
                self.assertLess(status, 500, path)
        self.assertEqual(self.alices_manuscript(), before)
        status, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: self.alice}
        )
        self.assertEqual([w["id"] for w in document["worlds"]], [self.alices_world])

    def test_the_world_commands_refuse_another_accounts_world(self) -> None:
        for command in ("open", "delete", "restore", "purge", "discard-preview"):
            with self.subTest(command):
                status, _, _, _ = self.as_bob(
                    "POST", f"/api/worlds/{command}", {"id": self.alices_world}
                )
                self.assertIn(status, (403, 404), command)
        _, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: self.alice}
        )
        self.assertEqual(len(document["worlds"]), 1)

    def test_trash_and_purge_of_a_trashed_world_stay_with_the_owner(self) -> None:
        self.json_request(
            "POST",
            "/api/worlds/delete",
            {"id": self.alices_world},
            cookies={SESSION_COOKIE: self.alice},
        )
        for command in ("restore", "purge"):
            status, _, _, _ = self.as_bob(
                "POST", f"/api/worlds/{command}", {"id": self.alices_world}
            )
            self.assertEqual(status, 403, command)
        _, document, _, _ = self.as_bob("GET", "/api/worlds/trash")
        self.assertEqual(document["worlds"], [])
        status, _, _, _ = self.json_request(
            "GET",
            f"/api/manuscript?world={self.alices_world}",
            cookies={SESSION_COOKIE: self.alice},
        )
        self.assertEqual(status, 404, "a trashed world is no longer opened by its id")

    def test_malformed_unknown_and_doubled_world_ids(self) -> None:
        for world in ("", "../../x", "A" * 32, "a" * 31, "g" * 32, "%00", "a" * 32 + "%0a"):
            status, _, _, _ = self.as_bob("GET", f"/api/manuscript?world={world}")
            self.assertEqual(status, 400, repr(world))
        status, _, _, _ = self.as_bob("GET", f"/api/manuscript?world={'a' * 32}")
        self.assertEqual(status, 404)
        status, _document, _, _ = self.as_bob(
            "GET", f"/api/manuscript?world={self.bobs_world}&world={self.alices_world}"
        )
        self.assertEqual(status, 200, "the first value decides, for the guard and the route alike")
        status, _, _, _ = self.as_bob(
            "GET", f"/api/manuscript?world={self.alices_world}&world={self.bobs_world}"
        )
        self.assertEqual(status, 403)

    def test_a_body_world_cannot_be_smuggled_next_to_a_query_world(self) -> None:
        before = self.alices_manuscript()
        status, _, _, _ = self.as_bob(
            "POST",
            f"/api/backup?world={self.bobs_world}",
            {"worldId": self.alices_world, "message": "x"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(self.alices_manuscript(), before)

    def test_project_transfer_export_is_owner_only(self) -> None:
        status, _, _, _ = self.as_bob(
            "GET", f"/api/project-transfer/export?world={self.alices_world}"
        )
        self.assertEqual(status, 403)
        status, _, _headers, _ = self.json_request(
            "GET",
            f"/api/project-transfer/export?world={self.alices_world}",
            cookies={SESSION_COOKIE: self.alice},
        )
        self.assertEqual(status, 200)

    def test_imports_create_worlds_for_the_caller_only(self) -> None:
        status, _document, _, _ = self.as_bob("POST", "/api/worlds/open-example", {"lang": "de"})
        self.assertEqual(status, 200)
        _, alices, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: self.alice}
        )
        self.assertEqual([w["id"] for w in alices["worlds"]], [self.alices_world])

    def test_the_answer_for_a_foreign_world_differs_from_an_unknown_one(self) -> None:
        """Observation: 403 for a world of another account, 404 for none. Ids are 128 random
        bits, so this is no enumeration oracle in practice."""
        foreign = self.as_bob("GET", f"/api/manuscript?world={self.alices_world}")[0]
        unknown = self.as_bob("GET", f"/api/manuscript?world={'b' * 32}")[0]
        self.assertEqual((foreign, unknown), (403, 404))

    def test_an_account_cannot_create_worlds_without_limit(self) -> None:
        """S268-9: there is no cap on the number of worlds per account (each one is a SQLite
        file plus mirror folders), and none on their total size."""
        created = 0
        for _ in range(60):
            status, _, _, _ = self.as_bob(
                "POST", "/api/worlds/create", {"title": "W", "backupUrl": ""}
            )
            if status != 200:
                break
            created += 1
        self.assertLess(created, 60)


class LocalBackupTests(TwoAccountsTests):
    """2.6"""

    def _backup(self, world: str) -> str:
        paths = self.application.application.worlds.paths_for(world).documents
        restore.backup_if_due(force=True, db_path=paths.database, backups_dir=paths.backups)
        return sorted(paths.backups.glob("backup-*.sqlite3"))[0].name

    def test_a_backup_name_cannot_leave_the_worlds_backup_folder(self) -> None:
        name = self._backup(self.bobs_world)
        for bad in (
            f"../{name}",
            "..\\..\\x.sqlite3",
            "/etc/passwd",
            "C:/Windows/x.sqlite3",
            "backup-../../x.sqlite3",
            "x.sqlite3",
            "",
            "backup-" + "a" * 5000 + ".sqlite3",
        ):
            with self.subTest(bad=bad):
                status, _, _, _ = self.as_bob(
                    "POST", "/api/backups/restore", {"worldId": self.bobs_world, "name": bad}
                )
                self.assertGreaterEqual(status, 400)
                self.assertLess(status, 500)
                status, _, _, _ = self.as_bob(
                    "GET", f"/api/backups/preview?world={self.bobs_world}&name={bad}"
                )
                self.assertEqual(status, 400)

    def test_another_worlds_backup_cannot_be_named_in_my_world(self) -> None:
        alices = self._backup(self.alices_world)
        self.json_request("GET", "/api/backups", cookies={SESSION_COOKIE: self.alice})
        status, _, _, _ = self.as_bob(
            "POST", "/api/backups/restore", {"worldId": self.bobs_world, "name": alices}
        )
        self.assertGreaterEqual(status, 400)
        _, document, _, _ = self.as_bob("GET", f"/api/backups?world={self.bobs_world}")
        self.assertNotIn(alices, json.dumps(document["backups"]))
        status, _, _, _ = self.as_bob(
            "POST", "/api/backups/restore", {"worldId": self.alices_world, "name": alices}
        )
        self.assertEqual(status, 403)

    def test_the_owner_can_restore_and_list_their_own_backups(self) -> None:
        name = self._backup(self.bobs_world)
        status, document, _, _ = self.as_bob(
            "POST", "/api/backups/restore", {"worldId": self.bobs_world, "name": name}
        )
        self.assertEqual(status, 200, document)

    @unittest.expectedFailure
    def test_the_storage_location_does_not_name_server_paths(self) -> None:
        """S268-10: `GET /api/backups/location` hands every account the absolute database
        and backup paths of the server (the data directory layout)."""
        _, document, _, _ = self.as_bob("GET", f"/api/backups/location?world={self.bobs_world}")
        storage = document["storage"]
        self.assertNotIn(str(self.root.resolve()), storage["databasePath"])
        self.assertNotIn(str(self.root.resolve()), storage["backupDirectory"])


class SyncAndSecretsTests(TwoAccountsTests):
    """2.7 and 2.9"""

    def test_device_sync_routes_are_closed_on_a_hosted_server(self) -> None:
        for method, table in (("GET", api_routes.GET), ("POST", api_routes.SAVE)):
            for path, registration in sorted(table.items()):
                if not registration.device_sync:
                    continue
                with self.subTest(method=method, path=path):
                    status, document, _, _ = self.as_bob(
                        method,
                        f"{path}?world={self.bobs_world}",
                        {"worldId": self.bobs_world} if method == "POST" else None,
                    )
                    self.assertEqual(status, 403)
                    self.assertEqual(document["error"]["code"], "sync.forbidden_hosted")

    def test_the_body_cases_of_device_sync_are_refused_too(self) -> None:
        status, document, _, _ = self.as_bob(
            "POST", "/api/backup", {"worldId": self.bobs_world, "push": True}
        )
        self.assertEqual((status, document["error"]["code"]), (403, "sync.forbidden_hosted"))
        status, document, _, _ = self.as_bob(
            "POST", "/api/worlds/create", {"title": "W", "backupUrl": "https://evil.example"}
        )
        self.assertEqual((status, document["error"]["code"]), (403, "sync.forbidden_hosted"))
        _, worlds, _, _ = self.as_bob("GET", "/api/worlds")
        self.assertTrue(all(not w["backupUrl"] for w in worlds["worlds"]))

    def test_a_hosted_session_never_yields_a_backup_credential(self) -> None:
        session = self.application.identity.auth.get_session(self.bob)
        with self.assertRaises(PermissionError):
            self.application.backup_authorization("https://backup.example", session)

    def test_a_credential_only_goes_to_the_endpoint_it_was_issued_for(self) -> None:
        authorizer = EndpointBoundBackupAuthorizer(
            default_endpoint="https://backup.example",
            environment_token="ENV-TOKEN",
            endpoint_token=lambda endpoint: (
                "LOGIN-TOKEN" if endpoint == "https://other.example" else ""
            ),
        )
        self.assertEqual(
            authorizer.authorize_local("https://backup.example").bearer_token, "ENV-TOKEN"
        )
        self.assertEqual(
            authorizer.authorize_local("https://other.example").bearer_token, "LOGIN-TOKEN"
        )
        for foreign in (
            "https://evil.example",
            "https://backup.example.evil.example",
            "http://backup.example",
        ):
            with self.assertRaises((PermissionError, ValueError, RuntimeError), msg=foreign):
                authorizer.authorize_local(foreign)

    def test_operator_only_routes_are_closed_for_every_account(self) -> None:
        for path, registration in sorted(api_routes.SAVE.items()):
            if registration.operator_only:
                status, document, _, _ = self.as_bob("POST", path, {})
                self.assertEqual(
                    (status, document["error"]["code"]), (403, "install.forbidden_hosted"), path
                )


class InformationRoutesTests(TwoAccountsTests):
    """2.8"""

    def test_whoami_and_capabilities_describe_only_the_caller(self) -> None:
        _, document, _, _ = self.as_bob("GET", "/api/whoami")
        self.assertEqual(document["sub"], "bob")
        self.assertNotIn("alice", json.dumps(document))
        _, document, _, _ = self.as_bob("GET", "/api/capabilities")
        self.assertNotIn("alice", json.dumps(document))
        self.assertEqual(set(document["user"]), {"serverAi"})

    def test_diagnostics_and_install_status_carry_no_paths_secrets_or_other_accounts(self) -> None:
        for path in (
            "/api/diagnostics",
            "/api/assistant/install/status",
            "/api/writing-assistance/status",
        ):
            with self.subTest(path):
                status, document, _, _ = self.as_bob("GET", path)
                self.assertEqual(status, 200)
                text = json.dumps(document)
                for forbidden in (
                    str(self.root.resolve()),
                    "audit-secret",
                    "alice",
                    self.alices_world,
                    "rt-",
                    "at-",
                ):
                    self.assertNotIn(forbidden, text, path)

    def test_the_version_probe_names_only_the_version(self) -> None:
        _status, document, _, _ = self.json_request("GET", "/api/version")
        self.assertEqual(set(document), {"ok", "version"})


if __name__ == "__main__":
    unittest.main()
