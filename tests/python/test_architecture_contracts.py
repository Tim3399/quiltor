from __future__ import annotations

import ast
import csv
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import Iterator


ROOT = Path(__file__).resolve().parents[2]


def _python_trees(directory: Path) -> Iterator[tuple[Path, ast.Module]]:
    """Yield parsed sources so dependency checks cannot be fooled by comments."""

    for path in sorted(directory.rglob("*.py")):
        yield path, ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _imported_names(tree: ast.Module) -> Iterator[tuple[int, str]]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.names:
                for alias in node.names:
                    yield node.lineno, f"{node.module}.{alias.name}"
            else:
                yield node.lineno, node.module


def _attribute_name(node: ast.AST) -> str | None:
    parts: list[str] = []
    current = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if not isinstance(current, ast.Name):
        return None
    parts.append(current.id)
    return ".".join(reversed(parts))


def _assignment_targets(node: ast.Assign | ast.AnnAssign) -> Iterator[str]:
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    for target in targets:
        if isinstance(target, (ast.Tuple, ast.List)):
            for item in target.elts:
                if isinstance(item, ast.Name):
                    yield item.id
        elif isinstance(target, ast.Name):
            yield target.id


def _is_mutable_runtime_value(value: ast.AST | None) -> bool:
    if isinstance(
        value,
        (
            ast.Dict,
            ast.List,
            ast.Set,
            ast.DictComp,
            ast.ListComp,
            ast.SetComp,
        ),
    ):
        return True
    if not isinstance(value, ast.Call):
        return False
    callee = _attribute_name(value.func) or ""
    leaf = callee.rsplit(".", 1)[-1]
    return leaf in {
        "dict",
        "list",
        "set",
        "defaultdict",
        "deque",
        "Lock",
        "RLock",
        "Event",
        "Condition",
        "Semaphore",
    } or leaf.casefold().endswith(("runtime", "store", "gateway", "vault", "client", "lock"))


class ArchitectureContractTests(unittest.TestCase):
    def test_application_use_cases_are_owned_by_bounded_contexts(self) -> None:
        application_root = ROOT / "src" / "quiltor" / "application"
        retired = [
            application_root / "operations.py",
            application_root / "models.py",
            application_root / "ports" / "backups.py",
            application_root / "ports" / "documents.py",
            application_root / "ports" / "worlds.py",
            application_root / "ports" / "observability.py",
        ]
        expected = {
            "worlds": {"ports.py", "types.py", "use_cases.py"},
            "documents": {"ports.py", "types.py", "use_cases.py"},
            "backups": {"ports.py", "types.py", "use_cases.py"},
            "history": {"errors.py", "ports.py", "types.py", "use_cases.py"},
            "assistant": {"use_cases.py"},
            "story_world": {"use_cases.py"},
        }

        self.assertFalse(any(path.exists() for path in retired), retired)
        violations: list[str] = []
        for context, required in expected.items():
            context_root = application_root / context
            present = {path.name for path in context_root.glob("*.py")}
            if not required <= present:
                violations.append(f"{context}: missing {sorted(required - present)}")
            use_cases = context_root / "use_cases.py"
            line_count = len(use_cases.read_text(encoding="utf-8").splitlines())
            if line_count > 320:
                violations.append(f"{context}: {line_count} lines recreates an application bucket")
            tree = ast.parse(use_cases.read_text(encoding="utf-8"), filename=str(use_cases))
            for node in tree.body:
                if isinstance(node, ast.ClassDef) and node.name in {
                    "ApplicationOperations",
                    "Operations",
                    "Service",
                }:
                    violations.append(f"{context}:{node.lineno}: generic collector {node.name}")

        routes_root = ROOT / "src" / "quiltor" / "delivery" / "http" / "routes"
        for path, tree in _python_trees(routes_root):
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and node.attr == "OPERATIONS":
                    violations.append(
                        f"{path.relative_to(ROOT).as_posix()}:{node.lineno}: legacy facade access"
                    )
                if isinstance(node, ast.Attribute) and node.attr == "application":
                    violations.append(
                        f"{path.relative_to(ROOT).as_posix()}:{node.lineno}: "
                        "route received the full application composition instead of its slice"
                    )
        self.assertEqual([], violations, "\n".join(violations))

    def test_history_http_routes_own_history_reads(self) -> None:
        routes = ROOT / "src" / "quiltor" / "delivery" / "http" / "routes"
        history = (routes / "history.py").read_text(encoding="utf-8")
        backup = (routes / "backup.py").read_text(encoding="utf-8")

        for path in (
            "/api/history",
            "/api/history/diff",
            "/api/history/chapter-text",
            "/api/history/chapter-comparison",
        ):
            self.assertIn(path, history)
            self.assertNotIn(path, backup)
        for retired in ("/api/log", "/api/diff", "/api/textfassung"):
            self.assertNotIn(retired, history + backup)
        self.assertIn("app.history", history)
        self.assertNotIn("app.backups", history)

    def test_web_host_has_no_import_time_product_state(self) -> None:
        path = ROOT / "src" / "quiltor" / "hosts" / "web" / "server.py"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        forbidden = {
            "IDENTITY",
            "OPERATIONS",
            "ASSISTANT",
            "ASSISTANT_JOBS",
            "WRITING_ASSISTANCE",
            "BACKUP_AUTHORIZER",
            "FEATURE_AVAILABILITY",
            "OBSERVABILITY",
        }
        assigned = {
            name
            for node in tree.body
            if isinstance(node, (ast.Assign, ast.AnnAssign))
            for name in _assignment_targets(node)
        }
        self.assertFalse(forbidden & assigned, forbidden & assigned)
        server_class = next(
            node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Server"
        )
        initializer = next(
            node
            for node in server_class.body
            if isinstance(node, ast.FunctionDef) and node.name == "__init__"
        )
        self.assertIn("application", [argument.arg for argument in initializer.args.args])

    def test_sqlite_persistence_stays_split_by_responsibility(self) -> None:
        persistence_root = ROOT / "src" / "quiltor" / "infrastructure" / "persistence"
        sqlite_root = persistence_root / "sqlite"
        adapter_root = persistence_root / "adapters"
        expected = {
            "assistant_history.py",
            "codec.py",
            "config.py",
            "connection.py",
            "manuscript.py",
            "migrations.py",
            "restore.py",
            "revisions.py",
            "schema.py",
            "story_world.py",
            "temporal.py",
            "time_system.py",
            "world_catalog.py",
        }
        parsed = list(_python_trees(sqlite_root))
        present = {path.name for path, _tree in parsed}

        self.assertFalse((persistence_root / "storage.py").exists())
        self.assertFalse((persistence_root / "repositories.py").exists())
        self.assertTrue(expected <= present, expected - present)
        self.assertEqual(
            {"backups.py", "documents.py", "worlds.py"},
            {path.name for path in adapter_root.glob("*.py") if path.name != "__init__.py"},
        )
        self.assertGreaterEqual(len(parsed), len(expected))

        config_source = (sqlite_root / "config.py").read_text(encoding="utf-8")
        catalog_source = (sqlite_root / "world_catalog.py").read_text(encoding="utf-8")
        adapter_source = (adapter_root / "worlds.py").read_text(encoding="utf-8")
        self.assertNotIn("ACTIVE_WORLD_ID", config_source + catalog_source)
        self.assertNotIn("from_legacy_globals", config_source + adapter_source)
        self.assertNotIn("def activate_world", catalog_source)
        self.assertNotIn("paths: config.SQLitePaths | None", catalog_source)
        self.assertNotIn("paths: config.SQLitePaths | None", adapter_source)

        violations: list[str] = []
        path_configuration_names = {"DATA", "DB", "BACKUPS", "WORLDS"}
        for path, tree in parsed:
            relative = path.relative_to(ROOT).as_posix()
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            if line_count > 600:
                violations.append(
                    f"{relative}: {line_count} lines recreates a persistence monolith"
                )
            if path.name != "config.py":
                for node in tree.body:
                    if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                        continue
                    configured = path_configuration_names.intersection(_assignment_targets(node))
                    if configured:
                        violations.append(
                            f"{relative}:{node.lineno}: copied path configuration "
                            f"{', '.join(sorted(configured))}"
                        )
            for line, imported in _imported_names(tree):
                if imported.startswith("quiltor.infrastructure.persistence.storage"):
                    violations.append(f"{relative}:{line}: imports retired storage monolith")

        for source_root in (ROOT / "src" / "quiltor", ROOT / "tools"):
            for path, tree in _python_trees(source_root):
                for line, imported in _imported_names(tree):
                    if imported.startswith("quiltor.infrastructure.persistence.storage"):
                        violations.append(
                            f"{path.relative_to(ROOT).as_posix()}:{line}: "
                            "imports retired storage monolith"
                        )

        self.assertEqual([], violations, "\n".join(violations))

    def test_product_modules_depend_on_ports_instead_of_runtime_adapters(self) -> None:
        module_root = ROOT / "src" / "quiltor" / "modules"
        parsed = list(_python_trees(module_root))
        self.assertGreater(len(parsed), 5, "product-module architecture scan is vacuous")

        violations: list[str] = []
        for path, tree in parsed:
            relative = path.relative_to(ROOT).as_posix()
            for line, imported in _imported_names(tree):
                if imported == "quiltor.infrastructure" or imported.startswith(
                    "quiltor.infrastructure."
                ):
                    violations.append(f"{relative}:{line}: concrete infrastructure import")
                if (
                    imported in {"os", "ssl", "sqlite3", "urllib"}
                    or imported.startswith(("os.", "ssl.", "sqlite3."))
                    or imported.startswith(("urllib.request", "urllib.error"))
                ):
                    violations.append(f"{relative}:{line}: runtime import {imported}")
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and _attribute_name(node) == "os.environ":
                    violations.append(f"{relative}:{node.lineno}: direct environment access")
                if (
                    relative.endswith("/modules/assistant/jobs.py")
                    and isinstance(node, ast.ClassDef)
                    and node.name == "AssistantJobStore"
                ):
                    violations.append(f"{relative}:{node.lineno}: concrete assistant job store")

        self.assertEqual([], violations, "\n".join(violations))

    def test_identity_modules_do_not_own_mutable_runtime_stores(self) -> None:
        identity_root = ROOT / "src" / "quiltor" / "modules" / "identity"
        parsed = list(_python_trees(identity_root))
        self.assertGreater(len(parsed), 2, "identity architecture scan is vacuous")

        violations: list[str] = []
        for path, tree in parsed:
            relative = path.relative_to(ROOT).as_posix()
            for node in tree.body:
                if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                    continue
                targets = [name for name in _assignment_targets(node) if not name.startswith("__")]
                value = node.value
                if targets and _is_mutable_runtime_value(value):
                    violations.append(
                        f"{relative}:{node.lineno}: mutable module state {', '.join(targets)}"
                    )

        self.assertEqual([], violations, "\n".join(violations))

    def test_http_routes_do_not_import_concrete_infrastructure(self) -> None:
        route_root = ROOT / "src" / "quiltor" / "delivery" / "http" / "routes"
        parsed = list(_python_trees(route_root))
        self.assertGreater(len(parsed), 3, "HTTP-route architecture scan is vacuous")

        violations = []
        for path, tree in parsed:
            relative = path.relative_to(ROOT).as_posix()
            for line, imported in _imported_names(tree):
                if imported == "quiltor.infrastructure" or imported.startswith(
                    "quiltor.infrastructure."
                ):
                    violations.append(f"{relative}:{line}: concrete infrastructure import")

        self.assertEqual([], violations, "\n".join(violations))

    def test_backup_login_runtime_has_no_mutable_module_store(self) -> None:
        path = ROOT / "src" / "quiltor" / "infrastructure" / "backup" / "login.py"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        violations = []
        for node in tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = [name for name in _assignment_targets(node) if not name.startswith("__")]
            if targets and _is_mutable_runtime_value(node.value):
                violations.append(
                    f"{path.relative_to(ROOT).as_posix()}:{node.lineno}: "
                    f"mutable module state {', '.join(targets)}"
                )

        self.assertEqual([], violations, "\n".join(violations))

    def test_native_bridge_schema_is_versioned_and_structured(self) -> None:
        schema = json.loads(
            (ROOT / "contracts" / "native-bridge" / "v1.schema.json").read_text(encoding="utf-8")
        )

        self.assertEqual(schema["$defs"]["request"]["properties"]["version"]["const"], 1)
        self.assertEqual(schema["$defs"]["response"]["properties"]["version"]["const"], 1)
        self.assertIn("operation", schema["$defs"]["request"]["required"])
        error_reference = schema["$defs"]["response"]["properties"]["error"]["$ref"]
        self.assertEqual(error_reference, "#/$defs/nativeError")
        error_schema = schema["$defs"]["nativeError"]
        self.assertIn("code", error_schema["required"])
        self.assertFalse(error_schema["additionalProperties"])
        for parameters in error_schema["properties"]["params"]["oneOf"]:
            self.assertFalse(parameters["additionalProperties"])

    def test_python_agrees_with_the_portable_timeline_fixture(self) -> None:
        with (ROOT / "contracts" / "fixtures" / "timeline-order.tsv").open(
            encoding="utf-8", newline=""
        ) as handle:
            rows = list(csv.DictReader(handle, delimiter="\t"))

        ordered = sorted(
            rows,
            key=lambda row: (int(row["time"]), int(row["position"]), row["id"]),
        )
        expected = sorted(rows, key=lambda row: int(row["expected_index"]))

        self.assertEqual(
            [row["id"] for row in ordered],
            [row["id"] for row in expected],
        )

    def test_backup_fixtures_are_accepted_by_the_runtime_contract(self) -> None:
        from quiltor.application.backup_manifest import (
            manifest_identifier,
            validate_manifest,
        )
        from quiltor.infrastructure.backup.snapshots import FORMAT_VERSION

        fixtures = []
        for version in (1, 2):
            fixture = json.loads(
                (ROOT / f"contracts/fixtures/backup/snapshot.v{version}.json").read_text(
                    encoding="utf-8"
                )
            )
            fixtures.append(fixture)
            validated = validate_manifest(
                fixture, expected_world="0123456789abcdef0123456789abcdef"
            )
            body = {key: value for key, value in fixture.items() if key != "id"}
            self.assertEqual(
                validated.identifier,
                manifest_identifier(body, version),
            )
        self.assertEqual(fixtures[-1]["format"], FORMAT_VERSION)

        # Exercise the concrete writer and reader as well as the shared validator.
        # This catches a producer that drifts while the hand-authored fixture stays
        # internally valid, or a reader that accepts only the fixture's shape.
        world_id = "0123456789abcdef0123456789abcdef"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "world.sqlite3"
            manuscripts = root / "manuscripts"
            profiles = root / "profiles"
            manuscripts.mkdir()
            profiles.mkdir()
            with closing(sqlite3.connect(database)):
                pass
            (manuscripts / "01 - Die Ankunft.md").write_text(
                "# Die Ankunft\n\nDer Atlas erwacht.\n", encoding="utf-8"
            )

            from quiltor.infrastructure.backup import SnapshotStore

            store = SnapshotStore(root / "history")
            context = store.context(
                world_id,
                "",
                database,
                manuscripts,
                profiles,
                title=fixtures[-1]["title"],
            )
            result = store.commit(context, fixtures[-1]["message"], push=False)
            self.assertTrue(result["ok"])
            produced = store.entries(context)[-1]

        consumed = validate_manifest(produced, expected_world=world_id)
        self.assertEqual(consumed.document, produced)
        self.assertEqual(set(produced), set(fixtures[-1]))
        self.assertEqual(set(produced["files"]), set(fixtures[-1]["files"]))
        for logical_path, descriptor in produced["files"].items():
            self.assertEqual(set(descriptor), set(fixtures[-1]["files"][logical_path]))
            self.assertIsInstance(descriptor["sha256"], str)
            self.assertIsInstance(descriptor["size"], int)

    def test_migration_contract_tip_is_the_runtime_schema_version(self) -> None:
        from quiltor.infrastructure.persistence.sqlite import config, migrations, schema

        fixture = json.loads(
            (ROOT / "contracts/fixtures/persistence/sqlite-migration-chain.v1.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(fixture["currentSchemaVersion"], schema.SCHEMA_VERSION)
        self.assertEqual(
            [(step["from"], step["to"]) for step in fixture["steps"]],
            list(
                zip(
                    range(fixture["baselineSchemaVersion"], schema.SCHEMA_VERSION),
                    range(
                        fixture["baselineSchemaVersion"] + 1,
                        schema.SCHEMA_VERSION + 1,
                    ),
                )
            ),
        )

        local_owner_step = next(
            step for step in fixture["steps"] if (step["from"], step["to"]) == (6, 7)
        )
        guarantee = " ".join(local_owner_step["guarantees"])
        self.assertIn("owner_sub", guarantee)
        self.assertIn(config.LOCAL_OWNER, guarantee)

        storyboard_step = next(
            step for step in fixture["steps"] if (step["from"], step["to"]) == (10, 11)
        )
        storyboard_guarantee = " ".join(storyboard_step["guarantees"])
        self.assertIn("Storyboard", storyboard_guarantee)
        self.assertIn("non-canon", storyboard_guarantee)

        # Bind that machine-readable chain step to the real migration instead of
        # merely checking that the fixture counts to the same integer.
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)")
            connection.executemany(
                "INSERT INTO meta(key,value) VALUES(?,?)",
                (
                    ("schema_version", "6"),
                    ("owner_sub", ""),
                    ("manuscript_revision", "41"),
                    ("figures_revision", "23"),
                ),
            )
            migrations.migrate(connection, 6)
            metadata = dict(connection.execute("SELECT key,value FROM meta"))

        self.assertEqual(metadata["schema_version"], str(schema.SCHEMA_VERSION))
        self.assertEqual(metadata["owner_sub"], config.LOCAL_OWNER)
        self.assertEqual(metadata["manuscript_revision"], "41")
        self.assertEqual(metadata["figures_revision"], "23")
        self.assertEqual(metadata["storyboards_revision"], "0")

    def test_mcp_runtime_catalog_is_generated_from_the_contract_fixture(self) -> None:
        from quiltor.hosts.mcp.quiltor_server import TOOLS

        fixture = json.loads(
            (ROOT / "contracts/fixtures/mcp/tools.v1.json").read_text(encoding="utf-8")
        )
        expected = [
            {"name": tool["name"], "inputSchema": tool["inputSchema"]} for tool in fixture["tools"]
        ]
        actual = [{"name": tool["name"], "inputSchema": tool["inputSchema"]} for tool in TOOLS]
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
