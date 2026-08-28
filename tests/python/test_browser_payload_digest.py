"""Deterministic browser payload digest tests."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

TOOLING = Path(__file__).resolve().parents[2] / "distribution" / "tooling"
sys.path.insert(0, str(TOOLING))

import browser_payload_digest  # noqa: E402


class BrowserPayloadDigestTests(unittest.TestCase):
    def test_digest_is_stable_and_sensitive_to_paths_modes_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "browser"
            nested.mkdir()
            executable = nested / "headless-shell"
            executable.write_bytes(b"browser")
            executable.chmod(0o755)
            first = browser_payload_digest.tree_sha256(root)

            self.assertEqual(first, browser_payload_digest.tree_sha256(root))
            executable.write_bytes(b"changed")
            self.assertNotEqual(first, browser_payload_digest.tree_sha256(root))
            executable.write_bytes(b"browser")
            renamed = nested / "renamed-headless-shell"
            executable.rename(renamed)
            self.assertNotEqual(first, browser_payload_digest.tree_sha256(root))
            renamed.rename(executable)
            if os.name != "nt":
                executable.chmod(0o644)
                self.assertNotEqual(first, browser_payload_digest.tree_sha256(root))

    def test_verify_rejects_invalid_or_different_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload").write_text("locked", encoding="utf-8")
            actual = browser_payload_digest.tree_sha256(root)

            self.assertEqual(browser_payload_digest.verify(root, actual), actual)
            with self.assertRaisesRegex(browser_payload_digest.PayloadDigestError, "lowercase"):
                browser_payload_digest.verify(root, "not-a-sha")
            with self.assertRaisesRegex(browser_payload_digest.PayloadDigestError, "mismatch"):
                browser_payload_digest.verify(root, "0" * 64)

    def test_contract_binds_platform_playwright_version_directory_and_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "chromium_headless_shell-1228"
            payload.mkdir()
            (payload / "headless-shell").write_bytes(b"browser")
            digest = browser_payload_digest.tree_sha256(payload)
            contract = root / "contract.json"
            contract.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "playwrightVersion": "1.61.1",
                        "payloads": {
                            "linux/amd64": {
                                "kind": "chromium-headless-shell",
                                "directory": payload.name,
                                "treeSha256": digest,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                browser_payload_digest.verify_contract(root, contract, "linux/amd64", "1.61.1"),
                digest,
            )
            with self.assertRaisesRegex(
                browser_payload_digest.PayloadDigestError, "Playwright version disagree"
            ):
                browser_payload_digest.verify_contract(root, contract, "linux/amd64", "1.61.0")

    @unittest.skipIf(os.name == "nt", "creating symlinks is not generally permitted on Windows")
    def test_symlink_target_is_part_of_the_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "first").write_text("one", encoding="utf-8")
            (root / "second").write_text("two", encoding="utf-8")
            link = root / "current"
            link.symlink_to("first")
            first = browser_payload_digest.tree_sha256(root)
            link.unlink()
            link.symlink_to("second")
            self.assertNotEqual(first, browser_payload_digest.tree_sha256(root))


if __name__ == "__main__":
    unittest.main()
