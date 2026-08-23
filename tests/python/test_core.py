"""Dependency rules for the pure story-world domain."""

import ast
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DOMAIN = REPO_ROOT / "src" / "quiltor" / "domain" / "story_world"
ASSISTANT = REPO_ROOT / "src" / "quiltor" / "modules" / "assistant"
STORY_WORLD_APPLICATION = REPO_ROOT / "src" / "quiltor" / "application" / "story_world"

FORBIDDEN_PREFIXES = (
    "quiltor.delivery",
    "quiltor.hosts",
    "quiltor.infrastructure",
    "quiltor.modules",
)


def _modules(root: Path) -> list[Path]:
    return [path for path in sorted(root.rglob("*.py")) if "__pycache__" not in path.parts]


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module)
    return names


class DomainIndependenceTests(unittest.TestCase):
    def test_domain_has_the_expected_story_world_modules(self):
        expected = {
            "entity_resolution.py",
            "knowledge.py",
            "time_system.py",
            "validation.py",
            "world_state.py",
        }
        self.assertTrue(expected <= {path.name for path in _modules(DOMAIN)})

    def test_domain_imports_no_outer_layer(self):
        offenders: dict[str, list[str]] = {}
        for path in _modules(DOMAIN):
            for imported in sorted(_imports(path)):
                if imported.startswith(FORBIDDEN_PREFIXES):
                    offenders.setdefault(str(path.relative_to(REPO_ROOT)), []).append(imported)
        self.assertEqual(offenders, {})

    def test_domain_dependencies_stay_in_the_domain_namespace(self):
        for path in _modules(DOMAIN):
            for imported in sorted(_imports(path)):
                if imported.startswith("quiltor."):
                    with self.subTest(path=path.name, imported=imported):
                        self.assertTrue(imported.startswith("quiltor.domain."))

    def test_persistence_and_backup_are_not_misfiled_as_domain(self):
        self.assertFalse((DOMAIN / "storage.py").exists())
        self.assertFalse((DOMAIN / "mirror.py").exists())
        self.assertFalse((DOMAIN / "backup").exists())
        sqlite_root = REPO_ROOT / "src/quiltor/infrastructure/persistence/sqlite"
        self.assertFalse((REPO_ROOT / "src/quiltor/infrastructure/persistence/storage.py").exists())
        self.assertTrue(
            {
                "connection.py",
                "config.py",
                "manuscript.py",
                "migrations.py",
                "restore.py",
                "revisions.py",
                "schema.py",
                "story_world.py",
                "world_catalog.py",
            }
            <= {path.name for path in _modules(sqlite_root)}
        )
        self.assertTrue((REPO_ROOT / "src/quiltor/infrastructure/backup/snapshots.py").is_file())

    def test_assistant_is_an_outer_module_that_reaches_inference_through_ports(self):
        self.assertTrue(ASSISTANT.is_dir())
        imports = {imported for path in _modules(ASSISTANT) for imported in _imports(path)}
        self.assertFalse(any(imported.startswith("quiltor.infrastructure") for imported in imports))
        self.assertIn("quiltor.modules.assistant.ports", imports)

    def test_story_world_application_never_depends_on_the_assistant_product_module(self):
        offenders = {
            str(path.relative_to(REPO_ROOT)): sorted(
                imported
                for imported in _imports(path)
                if imported == "quiltor.modules.assistant"
                or imported.startswith("quiltor.modules.assistant.")
            )
            for path in _modules(STORY_WORLD_APPLICATION)
        }
        self.assertEqual({path: imports for path, imports in offenders.items() if imports}, {})


if __name__ == "__main__":
    unittest.main()
