"""F-268-19: the operator variables of T-268 reach their container on the compose path.

docker-compose.yml passes each variable to a service one by one, so a variable that is
read in the code but missing there cannot be set by anyone who deploys with this file.
Read as text: the file is the contract, and no container needs to run for it.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE = REPO_ROOT / "docker-compose.yml"
ENV_EXAMPLE = REPO_ROOT / ".env.example"

APP_VARIABLES = (
    "QUILTOR_TRUSTED_PROXIES",
    "QUILTOR_MAX_WORLDS_PER_ACCOUNT",
    "QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT",
    "QUILTOR_GRAMMAR_MAX_CONCURRENT",
    "QUILTOR_GRAMMAR_MAX_PER_MINUTE",
    "QUILTOR_MAX_HANDLER_THREADS",
)
BACKUP_VARIABLES = (
    "QUILTOR_BACKUP_OIDC_ALLOWED_CLIENTS",
    "QUILTOR_BACKUP_DEFAULT_LIMIT_BYTES",
    "QUILTOR_BACKUP_HEADER_DEADLINE_SECONDS",
    "QUILTOR_BACKUP_BODY_BASE_DEADLINE_SECONDS",
    "QUILTOR_BACKUP_BODY_MIN_RATE_BYTES_PER_SECOND",
    "QUILTOR_BACKUP_MAX_CONCURRENT_UPLOADS",
)


def service_block(name: str) -> str:
    """The lines of one service under `services:`, up to the next service or top-level key."""
    text = COMPOSE.read_text(encoding="utf-8")
    match = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-z][\w-]*:\n|^\S)", text, re.M | re.S)
    if match is None:
        raise AssertionError(f"docker-compose.yml has no service {name!r}")
    return match.group(1)


def environment(name: str) -> dict[str, str]:
    block = service_block(name)
    section = re.search(r"^    environment:\n((?:^      .*\n|^\s*\n)*)", block, re.M)
    if section is None:
        return {}
    return dict(re.findall(r"^      ([A-Z][A-Z0-9_]*): (.*)$", section.group(1), re.M))


class ComposePassesTheOperatorVariables(unittest.TestCase):
    def test_the_app_container_receives_each_of_its_variables(self):
        passed = environment("quiltor")
        for variable in APP_VARIABLES:
            with self.subTest(variable=variable):
                self.assertIn(variable, passed)
                self.assertIn(f"${{{variable}", passed[variable])

    def test_the_backup_container_receives_each_of_its_variables(self):
        passed = environment("backup")
        for variable in BACKUP_VARIABLES:
            with self.subTest(variable=variable):
                self.assertIn(variable, passed)
                self.assertIn(f"${{{variable}", passed[variable])

    def test_allowed_clients_follow_the_backup_client_and_are_never_empty(self):
        """An operator with their own QUILTOR_BACKUP_CLIENT_ID must not get 401 on every
        backup, and an empty list would let no client in at all."""
        value = environment("backup")["QUILTOR_BACKUP_OIDC_ALLOWED_CLIENTS"]
        self.assertEqual(
            value,
            "${QUILTOR_BACKUP_OIDC_ALLOWED_CLIENTS:-${QUILTOR_BACKUP_CLIENT_ID:-quiltor-desktop}}",
        )

    def test_env_example_names_every_variable(self):
        text = ENV_EXAMPLE.read_text(encoding="utf-8")
        for variable in (*APP_VARIABLES, *BACKUP_VARIABLES, "QUILTOR_BACKUP_CLIENT_ID"):
            with self.subTest(variable=variable):
                self.assertIn(variable, text)


class PdfShellSandbox(unittest.TestCase):
    def test_the_app_container_runs_with_the_chromium_seccomp_profile(self):
        """The PDF shell keeps Chromium's own sandbox (S269-103): Docker's default seccomp
        profile refuses the user namespace it needs."""
        block = service_block("quiltor")
        self.assertRegex(
            block,
            r"(?m)^    security_opt:\n(?:^      #.*\n)*^      - seccomp=\./distribution/containers/seccomp-chromium\.json$",
        )
        self.assertTrue((REPO_ROOT / "distribution/containers/seccomp-chromium.json").is_file())


if __name__ == "__main__":
    unittest.main()
