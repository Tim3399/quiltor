import importlib.util
import re
import unittest
from pathlib import Path

TYPER_AVAILABLE = importlib.util.find_spec("typer") is not None
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "src" / "quiltor"
CLI_MAIN = SOURCE / "hosts" / "cli" / "main.py"

# Read by the server but deliberately not a persisted setting.
NOT_PERSISTED = {
    # A secret that must die with its process (see the note beside KNOWN_KEYS).
    "QUILTOR_MASTER_TOKEN",
    # Handed from one Quiltor process to its own sidecar.
    "QUILTOR_SIDECAR_KEY",
    "QUILTOR_RENDER_URL",
    # Set by the host or the build, not by the user.
    "QUILTOR_RUNTIME_HOST",
    "QUILTOR_BUILD_PROFILE",
    # Test-only switch.
    "QUILTOR_TEST_HOOKS",
}


def _variables_read_in_sources() -> set[str]:
    names: set[str] = set()
    for path in SOURCE.rglob("*.py"):
        if path == CLI_MAIN:
            continue
        names.update(
            re.findall(r"[\"'](QUILTOR_[A-Z0-9_]*[A-Z0-9])[\"']", path.read_text(encoding="utf-8"))
        )
    return names


@unittest.skipUnless(TYPER_AVAILABLE, "The packaged CLI dependency typer is not installed")
class CliConfigKeysTests(unittest.TestCase):
    def test_the_audit_variables_are_listed_with_a_description(self):
        from quiltor.hosts.cli.main import KNOWN_KEYS

        for name in (
            "QUILTOR_ASSISTANT_CLIENT_AI",
            "QUILTOR_ASSISTANT_CLIENT_JOBS",
            "QUILTOR_CSP",
            "QUILTOR_CSP_CONNECT_EXTRA",
        ):
            with self.subTest(name=name):
                self.assertIn(name, KNOWN_KEYS)
                self.assertGreater(len(KNOWN_KEYS[name]), 20)

    def test_every_variable_the_sources_read_is_listed_or_excluded_on_purpose(self):
        from quiltor.hosts.cli.main import KNOWN_KEYS

        missing = _variables_read_in_sources() - set(KNOWN_KEYS) - NOT_PERSISTED
        self.assertEqual(
            sorted(missing),
            [],
            "read in src/ but neither in KNOWN_KEYS nor in NOT_PERSISTED",
        )

    def test_the_master_token_stays_out_of_the_persisted_list(self):
        from quiltor.hosts.cli.main import KNOWN_KEYS

        self.assertNotIn("QUILTOR_MASTER_TOKEN", KNOWN_KEYS)


class SmokeInstallTokenPathTests(unittest.TestCase):
    """The native smokes cannot run here; they are held to the token path by their text."""

    def _script(self, relative: str) -> str:
        return (REPO_ROOT / "distribution" / "desktop" / relative).read_text(encoding="utf-8")

    def test_windows_smoke_checks_the_token_path_of_the_current_build(self):
        script = self._script("windows/direct/smoke-install.ps1")
        self.assertIn('"/api/whoami"', script)
        self.assertIn("-ne 401", script)
        self.assertIn('"/?token=$Token"', script)
        self.assertIn("-ne 302", script)
        self.assertIn("-ne 200", script)
        self.assertIn("$env:QUILTOR_MASTER_TOKEN = $ProcessToken", script)
        self.assertIn("if ($CheckToken) { Assert-OwnerTokenPath $ProcessToken }", script)
        # Held for the current version only, and never printed.
        self.assertEqual(script.count("Start-AndProbe $Version $true"), 2)
        self.assertNotRegex(script, r"Write-(Host|Output)[^\n]*\$(Process)?Token")

    def test_macos_smoke_checks_the_token_path_of_the_current_build(self):
        script = self._script("macos/direct/smoke-install.sh")
        self.assertIn('"$base/api/whoami"', script)
        self.assertIn("expected 401", script)
        self.assertIn('"$base/?token=$token"', script)
        self.assertIn("expected 302", script)
        self.assertIn("expected 200", script)
        self.assertIn("QUILTOR_MASTER_TOKEN=$process_token", script)
        self.assertIn('assert_owner_token_path "$process_token"', script)
        self.assertEqual(script.count('launch_and_probe "$VERSION" 1'), 2)
        self.assertNotRegex(script, r"echo[^\n]*\$\{?(process_)?token\b")


if __name__ == "__main__":
    unittest.main()
