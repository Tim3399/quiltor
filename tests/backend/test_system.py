"""The OS layer (backend/system/) and the rule it exists to enforce.

Two jobs here. First, check that the Windows and Linux implementations are
actually complete -- they are never imported on the Mac this is usually run on,
so nothing else would notice a missing function until someone shipped a build.
Second, enforce that no module outside backend/system/ branches on the OS --
a rule that only holds if something checks it, since each branch elsewhere
looks like a small correct decision on its own.
"""
import ast
import builtins
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import system
from backend.system import contract, linux, macos, windows

REPO_ROOT = Path(__file__).resolve().parents[2]
SYSTEM_PACKAGE = REPO_ROOT / "backend" / "system"

#: Names that mean "this code is deciding something based on the OS".
OS_BRANCH_NAMES = {"platform", "machine", "mac_ver", "win32_ver", "libc_ver", "uname"}

#: Everything Python we ship or run. Excludes build output and virtualenvs.
SOURCE_DIRS = ("backend", "hosts", "packaging", "scripts", "tests")
SOURCE_FILES = ("server.py",)


def _python_sources() -> list[Path]:
    found = [REPO_ROOT / name for name in SOURCE_FILES]
    for directory in SOURCE_DIRS:
        found.extend(sorted((REPO_ROOT / directory).rglob("*.py")))
    return [path for path in found if path.exists() and "__pycache__" not in path.parts]


class ContractCompletenessTests(unittest.TestCase):
    """Every OS module has to satisfy the same surface, checked on whatever
    machine happens to run the suite rather than only on its own OS."""

    def test_every_os_module_satisfies_the_contract(self):
        for module in (macos, windows, linux):
            with self.subTest(module=module.__name__):
                self.assertIsInstance(module, contract.SystemModule)

    def test_the_sandbox_container_id_is_what_marks_a_mac_app_store_build(self):
        """macOS exports APP_SANDBOX_CONTAINER_ID into every sandboxed process,
        and the App Sandbox is mandatory for Store apps -- so its presence is
        the signal, and one build behaves correctly in either context with no
        compile-time flag.

        Called on the module rather than through backend.system, which selects
        by the running OS: this is a claim about macOS and has to hold when the
        suite runs on Linux, as it does in CI. Reading an environment variable
        needs no Mac. Linux answers False regardless, because no Linux store
        build exists."""
        with patch.dict("os.environ", {"APP_SANDBOX_CONTAINER_ID": "app.quiltor.desktop"}, clear=True):
            self.assertTrue(macos.in_os_app_package())
            self.assertFalse(linux.in_os_app_package())
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(macos.in_os_app_package())

    def test_every_os_module_implements_the_whole_surface(self):
        """isinstance() against a runtime_checkable Protocol only checks that the
        names exist, and only for the members it can see -- so spell the surface
        out and check each module has all of it."""
        surface = [name for name in vars(contract.SystemModule).get("__annotations__", {})]
        surface += [name for name in dir(contract.SystemModule)
                    if not name.startswith("_") and callable(getattr(contract.SystemModule, name, None))]
        self.assertIn("data_home", surface)  # guard against the introspection silently finding nothing
        for module in (macos, windows, linux):
            for name in surface:
                with self.subTest(module=module.__name__, member=name):
                    self.assertTrue(hasattr(module, name), f"{module.__name__} is missing {name}")

    def test_the_package_re_exports_the_selected_implementation(self):
        self.assertTrue(callable(system.data_home))
        self.assertIn(system.os_name(), ("macos", "windows", "linux"))
        self.assertIn(system.machine_arch(), ("arm64", "x64"))

    def test_executable_name_differs_only_on_windows(self):
        self.assertEqual(macos.executable_name("llama-server"), "llama-server")
        self.assertEqual(linux.executable_name("llama-server"), "llama-server")
        self.assertEqual(windows.executable_name("llama-server"), "llama-server.exe")

    def test_only_windows_asks_for_spawn_flags(self):
        self.assertEqual(macos.spawn_flags(), 0)
        self.assertEqual(linux.spawn_flags(), 0)

    def test_quarantine_stripping_is_a_no_op_off_macos(self):
        """Must not raise -- installer.py calls it unconditionally now."""
        windows.strip_quarantine(Path("/nonexistent"))
        linux.strip_quarantine(Path("/nonexistent"))

    def test_binding_a_child_lifetime_is_a_no_op_on_posix(self):
        macos.bind_child_lifetime(object())
        linux.bind_child_lifetime(object())

    def test_revealing_a_folder_prefers_nsworkspace_over_the_open_subprocess(self):
        """`/usr/bin/open` is a LaunchServices client the App Sandbox denies.
        NSWorkspace is permitted and needs no entitlement."""
        workspace = MagicMock()
        appkit = MagicMock()
        appkit.NSWorkspace.sharedWorkspace.return_value = workspace
        with patch.dict("sys.modules", {"AppKit": appkit}):
            with patch("backend.system.macos.subprocess.run") as spawned:
                macos.reveal_in_file_manager(Path("/tmp/quiltor"))
        spawned.assert_not_called()
        workspace.activateFileViewerSelectingURLs_.assert_called_once()

    def test_revealing_a_folder_falls_back_when_pyobjc_is_absent(self):
        """A source checkout and the plain CLI have no pyobjc -- it arrives with
        the desktop extra, via pywebview. Those are never sandboxed, so the
        subprocess is still correct there."""
        real_import = builtins.__import__

        def without_appkit(name, *args, **kwargs):
            if name == "AppKit":
                raise ImportError("no pyobjc here")
            return real_import(name, *args, **kwargs)

        with patch.object(builtins, "__import__", without_appkit):
            with patch("backend.system.macos.subprocess.run") as spawned:
                macos.reveal_in_file_manager(Path("/tmp/quiltor"))
        self.assertEqual(spawned.call_args.args[0], ["open", "/tmp/quiltor"])


class NoOsBranchingOutsideTheSystemPackageTests(unittest.TestCase):
    """The rule that makes backend/system/ worth having.

    Its predecessor claimed in a docstring to be the only place branching on
    sys.platform, and by the time it was replaced there were thirteen branches
    in six other modules. A docstring cannot hold a line; this can.
    """

    def _offenders(self, path: Path) -> list[str]:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        hits = []
        for node in ast.walk(tree):
            # sys.platform
            if isinstance(node, ast.Attribute) and node.attr == "platform":
                if isinstance(node.value, ast.Name) and node.value.id == "sys":
                    hits.append(f"line {node.lineno}: sys.platform")
            # platform.system() / platform.machine() / ...
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                target = node.func
                if (isinstance(target.value, ast.Name) and target.value.id == "platform"
                        and target.attr in OS_BRANCH_NAMES):
                    hits.append(f"line {node.lineno}: platform.{target.attr}()")
        return hits

    def test_nothing_outside_backend_system_branches_on_the_os(self):
        offenders = {}
        for path in _python_sources():
            if SYSTEM_PACKAGE in path.parents or path == Path(__file__):
                continue
            hits = self._offenders(path)
            if hits:
                offenders[str(path.relative_to(REPO_ROOT))] = hits

        self.assertEqual(offenders, {}, "\n".join(
            [
                "OS branching belongs in backend/system/. Ask it for an answer "
                "(os_name(), machine_arch(), spawn_flags(), executable_name(), ...) "
                "or add a member to its contract:",
                *(f"  {path}: {', '.join(hits)}" for path, hits in sorted(offenders.items())),
            ]))

    def test_the_check_actually_finds_something(self):
        """A scanner that silently matches nothing would pass forever."""
        self.assertTrue(any(self._offenders(path) for path in sorted(SYSTEM_PACKAGE.glob("*.py"))),
                        "the OS-branch scanner found no branches even inside backend/system/")


if __name__ == "__main__":
    unittest.main()
