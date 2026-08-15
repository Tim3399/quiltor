"""The direction of dependencies between hosts/ and backend/.

hosts/ holds the ways Quiltor can be run: a native window, the CLI, an MCP stdio
server. Each owns a process and decides how the user reaches the application.
backend/ is the application, and must stay usable by all of them -- which it
only does as long as it never reaches back.

That rule is the entire reason the split exists, so it is checked rather than
described. `import server` inside a host is fine and expected: server.py is the
HTTP application, not a fourth host.
"""
import ast
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
HOSTS = REPO_ROOT / "hosts"


def _imported_names(path: Path) -> set[str]:
    """Top-level package of everything this module imports, function-level
    imports included -- those are how a cycle usually sneaks in."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            # A relative import can never leave the package it is in.
            if node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return names


def _modules(root: Path) -> list[Path]:
    return [p for p in sorted(root.rglob("*.py")) if "__pycache__" not in p.parts]


class DependencyDirectionTests(unittest.TestCase):
    def test_backend_never_imports_a_host(self):
        offenders = {
            str(path.relative_to(REPO_ROOT)): sorted(_imported_names(path) & {"hosts"})
            for path in _modules(BACKEND)
            if "hosts" in _imported_names(path)
        }
        self.assertEqual(offenders, {}, (
            "backend/ is the application and must stay runnable by every host. "
            f"These reach back into hosts/: {offenders}"))

    def test_backend_never_imports_the_server_application_either(self):
        """server.py imports backend, so the reverse would be a cycle -- and it
        would quietly make backend/ unusable from the CLI and the MCP server,
        neither of which starts an HTTP server."""
        offenders = {
            str(path.relative_to(REPO_ROOT))
            for path in _modules(BACKEND)
            if "server" in _imported_names(path)
        }
        self.assertEqual(offenders, set())

    def test_hosts_do_not_import_each_other(self):
        """Three independent entry points. The desktop app importing the CLI, or
        the MCP server importing the desktop window, would mean the frozen
        bundle drags in things it never runs."""
        for path in _modules(HOSTS):
            package = path.relative_to(HOSTS).parts[0]
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("hosts."):
                    other = node.module.split(".")[1]
                    with self.subTest(module=str(path.relative_to(REPO_ROOT))):
                        self.assertEqual(other, package, f"{path.name} imports hosts.{other}")


class ScriptInvocationTests(unittest.TestCase):
    """Each host has to survive being run as a plain path.

    Moving these under hosts/ broke exactly this: `python hosts/desktop/app.py`
    puts hosts/desktop/ on sys.path rather than the repository root, so the
    module-level `from backend.system import ...` failed with ModuleNotFoundError.
    The console script, `python -m`, and the frozen build all resolved fine,
    which is why nothing else noticed.
    """

    def _runs_as_a_script(self, module: Path) -> None:
        """Execute the module's top level in a subprocess set up exactly like a
        path invocation: the module's own directory on sys.path, the repository
        root nowhere, and the working directory somewhere else entirely.

        Loaded under a name that is not "__main__", so the `if __name__ ==
        "__main__"` guard does not fire and nothing starts listening -- the
        module-level imports are what is under test.
        """
        probe = (
            "import importlib.util, pathlib, sys\n"
            f"path = pathlib.Path({str(module)!r})\n"
            "sys.path.insert(0, str(path.parent))\n"
            "spec = importlib.util.spec_from_file_location('_probe', path)\n"
            "module = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(module)\n"
        )
        with tempfile.TemporaryDirectory() as elsewhere:
            environment = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
            result = subprocess.run([sys.executable, "-c", probe], cwd=elsewhere, env=environment,
                                    capture_output=True, text=True, timeout=60)
        name = module.relative_to(REPO_ROOT) if module.is_relative_to(REPO_ROOT) else module
        self.assertEqual(result.returncode, 0, f"{name} cannot be run by path:\n{result.stderr}")

    def test_the_probe_would_notice_a_missing_guard(self):
        """A module importing backend/ without putting the repository root on
        sys.path first must fail this probe -- otherwise the two tests below
        would pass no matter what."""
        with tempfile.TemporaryDirectory() as folder:
            unguarded = Path(folder) / "unguarded.py"
            unguarded.write_text("from backend import storage\n", encoding="utf-8")
            with self.assertRaises(AssertionError):
                self._runs_as_a_script(unguarded)

    def test_the_desktop_host_can_be_run_by_path(self):
        self._runs_as_a_script(HOSTS / "desktop" / "app.py")

    def test_the_mcp_host_can_be_run_by_path(self):
        self._runs_as_a_script(HOSTS / "mcp" / "quiltor_server.py")

    def test_the_repo_root_guard_comes_before_the_backend_import(self):
        """Order is the whole point -- a sys.path fix below the import is dead
        code. Checked by line number rather than by importing, because importing
        succeeds here regardless: the test runner already has the root on path."""
        for module in (HOSTS / "desktop" / "app.py", HOSTS / "mcp" / "quiltor_server.py"):
            with self.subTest(module=module.name):
                lines = module.read_text(encoding="utf-8").splitlines()
                guard = next(i for i, line in enumerate(lines) if "sys.path.insert" in line)
                first_backend = next(i for i, line in enumerate(lines)
                                     if line.startswith(("from backend", "import backend")))
                self.assertLess(guard, first_backend)


class EntryPointTests(unittest.TestCase):
    """The paths other files name. Each of these is referenced from outside
    Python -- a stale one fails at install or launch time, not here, so pin
    them."""

    def test_the_declared_console_scripts_exist(self):
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        for target, module, function in (
            ("quiltor", HOSTS / "cli" / "main.py", "main_entry"),
            ("quiltor-desktop", HOSTS / "desktop" / "app.py", "main"),
        ):
            with self.subTest(script=target):
                self.assertTrue(module.exists(), f"{module} is missing")
                self.assertIn(f"def {function}", module.read_text(encoding="utf-8"))
                dotted = str(module.relative_to(REPO_ROOT).with_suffix("")).replace("/", ".")
                self.assertIn(f'{target} = "{dotted}:{function}"', pyproject)

    def test_the_mcp_configuration_points_at_the_real_server(self):
        config = (REPO_ROOT / ".mcp.json").read_text(encoding="utf-8")
        self.assertIn("hosts/mcp/quiltor_server.py", config)
        self.assertTrue((HOSTS / "mcp" / "quiltor_server.py").exists())

    def test_the_pyinstaller_spec_points_at_the_desktop_host(self):
        spec = (REPO_ROOT / "packaging" / "quiltor.spec").read_text(encoding="utf-8")
        self.assertIn('"hosts" / "desktop" / "app.py"', spec)

    def test_the_wheel_ships_both_packages(self):
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('packages = ["backend", "hosts"]', pyproject)


if __name__ == "__main__":
    unittest.main()
