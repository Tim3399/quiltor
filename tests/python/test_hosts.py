"""Composition-root boundaries and executable source paths."""

import ast
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = REPO_ROOT / "src" / "quiltor"
HOSTS = PACKAGE / "hosts"


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


class DependencyDirectionTests(unittest.TestCase):
    def test_non_host_layers_never_import_a_composition_root(self):
        offenders = {}
        for root_name in ("domain", "modules", "infrastructure", "delivery"):
            for path in _modules(PACKAGE / root_name):
                hits = sorted(name for name in _imports(path) if name.startswith("quiltor.hosts"))
                if hits:
                    offenders[str(path.relative_to(REPO_ROOT))] = hits
        self.assertEqual(offenders, {})

    def test_mcp_host_does_not_drag_in_window_or_http_hosts(self):
        imports = {name for path in _modules(HOSTS / "mcp") for name in _imports(path)}
        self.assertFalse(any(name.startswith("quiltor.hosts.desktop") for name in imports))
        self.assertFalse(any(name.startswith("quiltor.hosts.web") for name in imports))


class ScriptInvocationTests(unittest.TestCase):
    def _runs_as_a_script(self, module: Path) -> None:
        probe = (
            "import importlib.util, pathlib, sys\n"
            f"path = pathlib.Path({str(module)!r})\n"
            "sys.path.insert(0, str(path.parent))\n"
            "spec = importlib.util.spec_from_file_location('_probe', path)\n"
            "module = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(module)\n"
        )
        with tempfile.TemporaryDirectory() as elsewhere:
            environment = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
            result = subprocess.run(
                [sys.executable, "-S", "-c", probe],
                cwd=elsewhere,
                env=environment,
                capture_output=True,
                text=True,
                timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_probe_would_notice_a_missing_src_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            unguarded = Path(folder) / "unguarded.py"
            unguarded.write_text("from quiltor import resources\n", encoding="utf-8")
            with self.assertRaises(AssertionError):
                self._runs_as_a_script(unguarded)

    def test_path_invocable_native_hosts_establish_the_src_root(self):
        for module in (
            HOSTS / "desktop" / "app.py",
            HOSTS / "mcp" / "quiltor_server.py",
        ):
            with self.subTest(module=module.name):
                self._runs_as_a_script(module)
                lines = module.read_text(encoding="utf-8").splitlines()
                guard = next(index for index, line in enumerate(lines) if "sys.path.insert" in line)
                first_package_import = next(
                    index
                    for index, line in enumerate(lines)
                    if line.startswith(("from quiltor", "import quiltor"))
                )
                self.assertLess(guard, first_package_import)


class EntryPointTests(unittest.TestCase):
    def test_the_declared_console_scripts_exist(self):
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        targets = (
            ("quiltor", HOSTS / "cli" / "main.py", "quiltor.hosts.cli.main", "main_entry"),
            (
                "quiltor-desktop",
                HOSTS / "desktop" / "app.py",
                "quiltor.hosts.desktop.app",
                "main",
            ),
            (
                "quiltor-mcp",
                HOSTS / "mcp" / "quiltor_server.py",
                "quiltor.hosts.mcp.quiltor_server",
                "main",
            ),
        )
        for script, module, dotted, function in targets:
            with self.subTest(script=script):
                self.assertTrue(module.is_file())
                self.assertIn(f"def {function}", module.read_text(encoding="utf-8"))
                self.assertIn(f'{script} = "{dotted}:{function}"', pyproject)

    def test_source_bootstrap_and_mcp_config_point_at_real_hosts(self):
        bootstrap = REPO_ROOT / "apps" / "web" / "server.py"
        self.assertIn(
            "from quiltor.hosts.web.server import main",
            bootstrap.read_text(encoding="utf-8"),
        )
        config = json.loads((REPO_ROOT / ".mcp.json").read_text(encoding="utf-8"))
        server = config["mcpServers"]["quiltor"]
        self.assertEqual(server, {"type": "stdio", "command": "quiltor-mcp", "args": []})
        self.assertNotIn(server["command"].casefold(), {"python", "python3", "py"})

    def test_pyinstaller_and_wheel_use_the_src_package(self):
        spec = (REPO_ROOT / "distribution" / "desktop" / "pyinstaller" / "quiltor.spec").read_text(
            encoding="utf-8"
        )
        self.assertIn('"src" / "quiltor" / "hosts" / "desktop" / "app.py"', spec)
        self.assertIn('pathex=[str(REPO_ROOT / "src")', spec)
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('packages = ["src/quiltor"]', pyproject)


if __name__ == "__main__":
    unittest.main()
