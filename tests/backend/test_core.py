"""The innermost ring: backend/core/ depends on nothing above it.

Worlds, chapters, figures, the snapshot history and the retrieval corpus are
what Quiltor *is*. Which OS it runs on, which store it shipped through and which
inference runtime is installed are all questions from further out, and core
answering any of them is how a domain layer stops being one.

Stated in backend/core/__init__.py, enforced here. A layering rule that lives
only in prose is worth very little: every individual import that crosses it
looks reasonable in isolation, and by the time the shape is obviously wrong the
work to undo it is large.
"""

import ast
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CORE = REPO_ROOT / "backend" / "core"

#: Everything core must stay ignorant of, and why it would be a mistake.
FORBIDDEN = {
    "backend.system": "the operating system",
    "backend.edition": "the distribution channel",
    "backend.llm": "the inference capability",
    "backend.language": "the language capability",
    "backend.pdf": "the PDF capability",
    "backend.assistant": "a service layered above core",
    "backend.auth": "the hosted deployment's OIDC client",
    "hosts": "a host",
    "server": "the HTTP application",
}


def _modules() -> list[Path]:
    return [p for p in sorted(CORE.rglob("*.py")) if "__pycache__" not in p.parts]


def _imports(path: Path) -> set[str]:
    """Absolute module names imported, function-level imports included -- a late
    import is still a dependency, and is the usual way one sneaks in."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module)
    return names


class CoreIndependenceTests(unittest.TestCase):
    def test_core_has_modules_to_check(self):
        """A rule enforced over an empty directory passes forever."""
        self.assertGreaterEqual(len(_modules()), 5)

    def test_core_imports_nothing_from_further_out(self):
        offenders: dict[str, list[str]] = {}
        for path in _modules():
            for imported in sorted(_imports(path)):
                for forbidden, reason in FORBIDDEN.items():
                    if imported == forbidden or imported.startswith(forbidden + "."):
                        offenders.setdefault(str(path.relative_to(REPO_ROOT)), []).append(
                            f"{imported} ({reason})"
                        )
        self.assertEqual(
            offenders,
            {},
            "\n".join(
                [
                    "backend/core/ is the domain and must not know how Quiltor is run or shipped:",
                    *(f"  {path}: {', '.join(hits)}" for path, hits in sorted(offenders.items())),
                ]
            ),
        )

    def test_core_only_imports_itself_within_backend(self):
        """The positive form of the same rule: any backend import from core has
        to stay inside core."""
        for path in _modules():
            for imported in sorted(_imports(path)):
                if imported.startswith("backend"):
                    with self.subTest(module=str(path.relative_to(REPO_ROOT)), imported=imported):
                        self.assertTrue(imported.startswith("backend.core"))

    def test_the_domain_modules_really_are_in_core(self):
        """Guards against the move being quietly half-undone."""
        for name in ("storage.py", "mirror.py", "validation.py", "knowledge.py"):
            with self.subTest(module=name):
                self.assertTrue((CORE / name).exists())
        self.assertTrue((CORE / "backup" / "snapshots.py").exists())

    def test_the_assistant_stayed_out_of_core(self):
        """It imports backend.llm, so filing it under core would break the rule
        core exists to state. Documented in backend/core/__init__.py."""
        assistant = REPO_ROOT / "backend" / "assistant"
        self.assertTrue(assistant.is_dir())
        self.assertFalse((CORE / "assistant").exists())
        reaches_capability = any(
            imported.startswith("backend.llm")
            for path in assistant.rglob("*.py")
            if "__pycache__" not in path.parts
            for imported in _imports(path)
        )
        self.assertTrue(
            reaches_capability, "if this is no longer true, reconsider where it belongs"
        )


if __name__ == "__main__":
    unittest.main()
