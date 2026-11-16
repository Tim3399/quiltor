"""T-269 Phase 2, package D (supply chain): evidence for the audit report.

Gaps are written as the property that should hold and marked
``@unittest.expectedFailure``: the suite stays green while the gap is open, and the
fix turns the test into an unexpected success, which fails the run. Each gap test
names its finding id (S269-1xx) in implementer/T-269-audit-supply.md.

The tests without the marker pin properties the report lists as "checked, no
finding", so a regression there shows up as well.

Read-only: nothing here downloads, installs or starts a process.
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import unittest
import zipfile
from http.client import HTTPMessage
from pathlib import Path
from typing import ClassVar
from unittest import mock

from quiltor.infrastructure.inference import install_manifest, installer, transfer
from quiltor.infrastructure.inference.install_manifest import ArtifactManifest
from quiltor.infrastructure.writing_assistance import languagetool

ROOT = Path(__file__).resolve().parents[2]
MLX_LOCK = ROOT / "src/quiltor/resources/sidecars/inference/mlx/requirements.lock"
LOCK_CONTRACT = ROOT / "distribution/dependency-locks.json"
LINT_TOOL = ROOT / "tools/dev/lint-tool.mjs"
PDF_SIDECAR = ROOT / "src/quiltor/resources/sidecars/pdf/render-book-pdf.mjs"
RELEASE_WORKFLOW = ROOT / ".github/workflows/release.yml"

REQUIREMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]*\])?==")


def _requirement_blocks(text: str) -> list[str]:
    """One string per requirement, with its backslash continuations joined."""

    blocks: list[str] = []
    current = ""
    for line in text.splitlines():
        stripped = line.strip()
        if not current and (not stripped or stripped.startswith("#")):
            continue
        current += " " + stripped.rstrip("\\")
        if not stripped.endswith("\\"):
            blocks.append(current.strip())
            current = ""
    return [block for block in blocks if REQUIREMENT_RE.match(block)]


class PythonLockHashes(unittest.TestCase):
    """6.8: every package line of a shipped lock carries a hash, not just the file."""

    def test_every_release_lock_binds_each_requirement_to_a_hash(self) -> None:
        locks = json.loads(LOCK_CONTRACT.read_text(encoding="utf-8"))["locks"]
        self.assertGreaterEqual(len(locks), 4)
        for lock in locks:
            with self.subTest(lock=lock["path"]):
                blocks = _requirement_blocks((ROOT / lock["path"]).read_text(encoding="utf-8"))
                self.assertTrue(blocks, "the lock lists no requirement")
                unhashed = [block.split()[0] for block in blocks if "--hash=sha256:" not in block]
                self.assertEqual(unhashed, [], "requirements without a hash")

    # S269-100
    def test_mlx_lock_binds_each_requirement_to_a_hash(self) -> None:
        blocks = _requirement_blocks(MLX_LOCK.read_text(encoding="utf-8"))
        self.assertTrue(blocks)
        unhashed = [block.split()[0] for block in blocks if "--hash=sha256:" not in block]
        self.assertEqual(unhashed, [], "MLX requirements without a hash")


class MlxRuntimeInstall(unittest.TestCase):
    """6.5b: the MLX runtime is executable code from PyPI, installed on the user's Mac."""

    def _pip_calls(self) -> list[list[str]]:
        with tempfile.TemporaryDirectory() as home:
            paths = installer.InstallerPaths.from_home(Path(home))
            with (
                mock.patch.object(installer, "is_store_distribution", return_value=False),
                mock.patch.object(installer, "is_apple_silicon", return_value=True),
                mock.patch.object(installer.subprocess, "run") as run,
                mock.patch("builtins.print"),
            ):
                installer.install_mlx_runtime(paths=paths)
        return [list(call.args[0]) for call in run.call_args_list if "pip" in call.args[0]]

    # S269-100
    def test_every_pip_install_requires_hashes(self) -> None:
        calls = self._pip_calls()
        self.assertTrue(calls)
        for call in calls:
            with self.subTest(call=" ".join(call[1:])):
                self.assertIn("--require-hashes", call)

    def test_runtime_packages_come_from_the_pinned_lock_as_binaries(self) -> None:
        calls = self._pip_calls()
        lock_installs = [call for call in calls if "-r" in call]
        self.assertEqual(len(lock_installs), 1)
        self.assertIn("--only-binary=:all:", lock_installs[0])
        self.assertEqual(Path(lock_installs[0][lock_installs[0].index("-r") + 1]), MLX_LOCK)


class ModelRevisionPin(unittest.TestCase):
    """6.5a: which model revision does the installer resolve?"""

    def _requested_urls(self) -> list[str]:
        urls: list[str] = []

        pin = install_manifest.PINNED_MODELS[installer.DEFAULT_MODEL_REPO]

        def read_json(url: str, **_: object) -> object:
            urls.append(url)
            return {"sha": pin.revision}

        def read_json_page(url: str, **_: object) -> tuple[object, str]:
            urls.append(url)
            entries = [
                {"type": "file", "path": path, "size": 1, "lfs": {"oid": digest.split(":")[1]}}
                for path, digest in pin.files.items()
            ]
            return entries, ""

        with (
            mock.patch.object(installer, "read_json", side_effect=read_json),
            mock.patch.object(installer, "read_json_page", side_effect=read_json_page),
            mock.patch("builtins.print"),
        ):
            installer._model_artifacts(installer.DEFAULT_MODEL_REPO)
        return urls

    # S269-101
    def test_default_model_is_resolved_at_a_commit_pinned_in_the_repository(self) -> None:
        revision_url = self._requested_urls()[0]
        self.assertRegex(revision_url, r"/revision/[0-9a-f]{40}$")

    def test_file_urls_use_the_resolved_commit_not_the_branch(self) -> None:
        urls = self._requested_urls()
        pin = install_manifest.PINNED_MODELS[installer.DEFAULT_MODEL_REPO].revision
        self.assertIn(f"/tree/{pin}?", urls[1])

    def test_a_listing_that_differs_from_the_pinned_digest_is_refused(self) -> None:
        pin = install_manifest.PINNED_MODELS[installer.DEFAULT_MODEL_REPO]
        tree = [
            {"type": "file", "path": path, "size": 1, "lfs": {"oid": "b" * 64}}
            for path in pin.files
        ]
        with (
            mock.patch.object(installer, "read_json", return_value={"sha": pin.revision}),
            mock.patch.object(installer, "read_json_page", return_value=(tree, "")),
            mock.patch("builtins.print"),
            self.assertRaisesRegex(ValueError, "pinned digest"),
        ):
            installer._model_artifacts(installer.DEFAULT_MODEL_REPO)


class LlamaCppDigestPin(unittest.TestCase):
    """6.5a: the runtime archive is checked against a digest kept in the repository."""

    # S269-105
    def test_release_digest_is_compared_with_the_repository_pin(self) -> None:
        name = f"llama-{install_manifest.LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip"
        release = {
            "tag_name": install_manifest.LLAMA_CPP_RELEASE,
            "assets": [
                {
                    "name": name,
                    "digest": "sha256:" + "c" * 64,
                    "size": 1,
                    "browser_download_url": "https://github.com/ggml-org/llama.cpp/releases/download/"
                    f"{install_manifest.LLAMA_CPP_RELEASE}/{name}",
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "pinned asset digest"):
            install_manifest.github_runtime_artifact(release, re.compile(r"win-cpu-x64\.zip$"))


class VerifiedBeforePublish(unittest.TestCase):
    """6.5a: a download that fails its digest never reaches the destination."""

    def test_digest_mismatch_leaves_no_file(self) -> None:
        payload = b"not the published bytes"
        artifact = ArtifactManifest(
            identifier="test:artifact",
            version="1",
            filename="artifact.bin",
            url="https://github.com/example/artifact.bin",
            digest_algorithm="sha256",
            digest="0" * 64,
            maximum_bytes=1024,
            expected_size=len(payload),
        )

        class Response(io.BytesIO):
            status = 200
            headers: ClassVar[dict[str, str]] = {"Content-Length": str(len(payload))}

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "artifact.bin"
            with (
                mock.patch.object(transfer, "_open_artifact", return_value=Response(payload)),
                mock.patch("builtins.print"),
            ):
                with self.assertRaisesRegex(ValueError, "integrity"):
                    transfer.download(artifact, target, "artifact")
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name(target.name + ".part").exists())

    def test_redirect_to_an_unlisted_host_is_refused(self) -> None:
        artifact = ArtifactManifest(
            identifier="test:artifact",
            version="1",
            filename="artifact.bin",
            url="https://github.com/example/artifact.bin",
            digest_algorithm="sha256",
            digest="0" * 64,
            maximum_bytes=1024,
            allowed_redirect_origins=("https://objects.githubusercontent.com",),
        )
        handler = transfer._ArtifactRedirect(artifact)
        request = mock.Mock(full_url=artifact.url)
        with self.assertRaisesRegex(ValueError, "trusted HTTPS origins"):
            handler.redirect_request(
                request, io.BytesIO(), 302, "Found", HTTPMessage(), "https://evil.test/x"
            )


class LanguageToolArchive(unittest.TestCase):
    """6.5c: the archive is checked against a pinned digest and unpacked inside its root."""

    def test_traversal_member_is_refused(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../escaped.txt", "x")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "inner"
            target.mkdir()
            with zipfile.ZipFile(buffer) as archive, self.assertRaises(ValueError):
                languagetool._safe_extract(archive, target)
            self.assertFalse((Path(directory) / "escaped.txt").exists())

    def test_download_url_is_https_and_digest_is_pinned(self) -> None:
        self.assertTrue(languagetool.LANGUAGETOOL_URL.startswith("https://languagetool.org/"))
        self.assertRegex(languagetool.LANGUAGETOOL_SHA256, r"^[0-9a-f]{64}$")


class ScannedLocks(unittest.TestCase):
    """6.7: every lock that ends up in a shipped artifact is scanned by osv."""

    @unittest.expectedFailure  # S269-102
    def test_self_hosted_node_lock_is_in_the_osv_list(self) -> None:
        source = LINT_TOOL.read_text(encoding="utf-8")
        body = source[source.index("function osvLockfiles()") :]
        body = body[: body.index("\n}\n")]
        self.assertIn("distribution/web/self-hosted/package-lock.json", body)


class PdfShellSandbox(unittest.TestCase):
    """6.13: the hosted PDF shell renders other people's text in Chromium."""

    # S269-103
    def test_chromium_is_launched_with_its_sandbox(self) -> None:
        # Playwright adds --no-sandbox unless chromiumSandbox is exactly true. Since F-269-13
        # the flag is a variable that is false only for an explicit QUILTOR_PDF_SANDBOX=off.
        source = PDF_SIDECAR.read_text("utf-8")
        launch = re.search(r"chromium\.launch\((\{[^)]*\})\)", source)
        assert launch is not None, "chromium.launch(...) not found"
        self.assertRegex(launch.group(1), r"chromiumSandbox:\s*sandbox\b")
        self.assertRegex(
            source,
            r'const sandbox = \(process\.env\.QUILTOR_PDF_SANDBOX \?\? ""\)'
            r'\.trim\(\)\.toLowerCase\(\) !== "off";',
        )


class SigningMaterial(unittest.TestCase):
    """6.11: signing secrets stay in the step that needs them."""

    @unittest.expectedFailure  # S269-104
    def test_windows_certificate_password_is_not_exported_to_later_steps(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        self.assertNotRegex(workflow, r"CERTIFICATE_PASSWORD=[^\n]*GITHUB_ENV")


if __name__ == "__main__":
    unittest.main()
