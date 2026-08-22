import hashlib
import stat
import re
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.application.capabilities import Feature
from quiltor.bootstrap import build_feature_availability
from quiltor.infrastructure.inference import installer
from quiltor.infrastructure.inference.coordinator import InstallationCoordinator
from quiltor.infrastructure.inference.archive import extract_archive, locate_expected_files
from quiltor.infrastructure.inference.install_manifest import (
    ArtifactManifest,
    LLAMA_CPP_RELEASE,
    github_runtime_artifact,
    huggingface_artifacts,
    safe_relative_path,
)
from quiltor.infrastructure.inference.installation import LocalAssistantInstallation
from quiltor.infrastructure.inference import transfer


class _FakeResponse:
    """Minimal stand-in for the object urllib.request.urlopen()'s context manager
    yields -- just enough of the interface download() actually uses."""

    def __init__(
        self,
        body: bytes,
        status: int,
        content_length: int | None = None,
        *,
        content_range: str = "",
    ):
        self._remaining = body
        self.status = status
        self.headers = {
            "Content-Length": str(content_length if content_length is not None else len(body))
        }
        if content_range:
            self.headers["Content-Range"] = content_range

    def read(self, n: int = -1) -> bytes:
        chunk, self._remaining = (
            self._remaining[:n] if n >= 0 else self._remaining,
            self._remaining[n:] if n >= 0 else b"",
        )
        return chunk

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class _FailingMidwayResponse:
    """Serves one chunk successfully, then raises -- simulates a dropped connection
    partway through a download, after some bytes have already reached disk."""

    def __init__(self, first_chunk: bytes, total_len: int):
        self._first_chunk = first_chunk
        self._served = False
        self.status = 200
        self.headers = {"Content-Length": str(total_len)}

    def read(self, n: int = -1) -> bytes:
        if not self._served:
            self._served = True
            return self._first_chunk
        raise ConnectionError("dropped")

    def __enter__(self) -> "_FailingMidwayResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


def _artifact(body: bytes, *, digest: str | None = None) -> ArtifactManifest:
    return ArtifactManifest(
        identifier="test:artifact",
        version="v1",
        filename="model.gguf",
        url="https://example.test/model.gguf",
        digest_algorithm="sha256",
        digest=digest or hashlib.sha256(body).hexdigest(),
        maximum_bytes=max(1024, len(body)),
        expected_size=len(body),
    )


class AssistantInstallationAdapterTests(unittest.TestCase):
    def test_composition_exposes_installer_only_through_the_product_port(self):
        coordinator = MagicMock()
        coordinator.read.return_value = {"running": True}
        coordinator.start.return_value = True
        installation = LocalAssistantInstallation(
            build_feature_availability(), coordinator=coordinator, home=Path("test-home")
        )
        with (
            patch.object(installer, "ensure_installed") as ensure,
            patch.object(installer, "is_configured", return_value=True) as configured,
            patch.object(installer, "resolve_runtime", return_value="llamacpp") as resolve,
        ):
            installation.ensure_installed()
            self.assertTrue(installation.is_configured())
            self.assertEqual(installation.read_state(), {"running": True})
            self.assertTrue(installation.start_async())

        expected_home = Path("test-home").resolve()
        ensure.assert_called_once_with(expected_home)
        configured.assert_called_once_with(expected_home)
        coordinator.read.assert_called_once_with()
        resolve.assert_called_once_with("auto")
        coordinator.start.assert_called_once()

    def test_central_capability_policy_can_disable_installation(self):
        capabilities = MagicMock()
        capabilities.is_available.return_value = False
        coordinator = MagicMock()
        installation = LocalAssistantInstallation(capabilities, coordinator=coordinator)
        with (
            patch.object(installer, "ensure_installed") as ensure,
            patch.object(installer, "is_configured") as configured,
        ):
            installation.ensure_installed()
            self.assertFalse(installation.is_configured())
            self.assertFalse(installation.start_async())

        capabilities.is_available.assert_any_call(Feature.LOCAL_INFERENCE)
        ensure.assert_not_called()
        configured.assert_not_called()
        coordinator.start.assert_not_called()


class DownloadResumeTest(unittest.TestCase):
    """download() used to always urlretrieve() from byte 0 -- for a multi-GB model
    download, an app closed (or a connection dropped) before it finished meant every
    later attempt silently redownloaded the whole thing again, forever. It now resumes
    a leftover .part file via an HTTP Range request instead.
    """

    def test_resumes_a_partial_download_via_range_request(self):
        full_content = b"x" * 30 + b"y" * 20
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            dest.with_name(dest.name + ".part").write_bytes(full_content[:30])
            remaining = full_content[30:]
            fake = _FakeResponse(
                remaining,
                status=206,
                content_length=len(remaining),
                content_range=f"bytes 30-49/{len(full_content)}",
            )
            requests: list[object] = []

            def fake_urlopen(request, timeout=30):
                requests.append(request)
                return fake

            with patch(
                "quiltor.infrastructure.inference.transfer._open_artifact",
                side_effect=lambda request, artifact: fake_urlopen(request),
            ):
                installer.download(_artifact(full_content), dest, "model.gguf")

            self.assertEqual(dest.read_bytes(), full_content)
            self.assertFalse(dest.with_name(dest.name + ".part").exists())
            self.assertEqual(dict(requests[0].header_items()).get("Range"), "bytes=30-")

    def test_restarts_clean_if_the_server_ignores_the_range_request(self):
        full_content = b"z" * 50
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            dest.with_name(dest.name + ".part").write_bytes(b"stale, unrelated leftover bytes")
            fake = _FakeResponse(full_content, status=200, content_length=len(full_content))

            with patch(
                "quiltor.infrastructure.inference.transfer._open_artifact",
                return_value=fake,
            ):
                installer.download(_artifact(full_content), dest, "model.gguf")

            self.assertEqual(dest.read_bytes(), full_content)

    def test_keeps_the_partial_file_on_failure_so_a_retry_can_resume_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            partial = dest.with_name(dest.name + ".part")
            fake = _FailingMidwayResponse(b"partial-bytes-already-on-disk", total_len=1000)
            artifact = ArtifactManifest(
                identifier="test:artifact",
                version="v1",
                filename="model.gguf",
                url="https://example.test/model.gguf",
                digest_algorithm="sha256",
                digest="0" * 64,
                maximum_bytes=1000,
                expected_size=1000,
            )

            with patch(
                "quiltor.infrastructure.inference.transfer._open_artifact",
                return_value=fake,
            ):
                with self.assertRaises(ConnectionError):
                    installer.download(artifact, dest, "model.gguf")

            self.assertTrue(partial.exists())
            self.assertEqual(partial.read_bytes(), b"partial-bytes-already-on-disk")
            self.assertFalse(dest.exists())

    def test_digest_mismatch_never_publishes_the_download(self):
        body = b"not-the-declared-artifact"
        fake = _FakeResponse(body, status=200)
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "model.gguf"
            with patch(
                "quiltor.infrastructure.inference.transfer._open_artifact",
                return_value=fake,
            ):
                with self.assertRaisesRegex(ValueError, "integrity"):
                    installer.download(_artifact(body, digest="0" * 64), destination, "model")
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_name("model.gguf.part").exists())

    def test_resume_rejects_a_mismatched_content_range(self):
        body = b"x" * 50
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "model.gguf"
            destination.with_name("model.gguf.part").write_bytes(body[:30])
            fake = _FakeResponse(
                body[30:],
                status=206,
                content_range="bytes 0-19/50",
            )
            with patch(
                "quiltor.infrastructure.inference.transfer._open_artifact",
                return_value=fake,
            ):
                with self.assertRaisesRegex(ValueError, "resume range"):
                    installer.download(_artifact(body), destination, "model")
            self.assertFalse(destination.exists())

    def test_artifact_redirects_must_stay_on_declared_https_origins(self):
        policy = transfer._ArtifactRedirect(_artifact(b"payload"))
        request = transfer.urllib.request.Request("https://example.test/model.gguf")
        with self.assertRaisesRegex(ValueError, "trusted HTTPS origins"):
            policy.redirect_request(
                request,
                None,
                302,
                "Found",
                {},
                "https://untrusted.example/payload",
            )

    def test_metadata_redirects_are_never_followed(self):
        request = transfer.urllib.request.Request("https://example.test/metadata")
        self.assertIsNone(
            transfer._NoRedirect().redirect_request(
                request,
                None,
                302,
                "Found",
                {},
                "https://example.test/other",
            )
        )


class InstallManifestTests(unittest.TestCase):
    def test_pinned_runtime_asset_requires_the_published_digest_and_size(self):
        release = {
            "tag_name": LLAMA_CPP_RELEASE,
            "assets": [
                {
                    "name": f"llama-{LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip",
                    "browser_download_url": (
                        "https://github.com/ggml-org/llama.cpp/releases/download/"
                        f"{LLAMA_CPP_RELEASE}/llama-{LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip"
                    ),
                    "digest": "sha256:" + "a" * 64,
                    "size": 1234,
                }
            ],
        }
        artifact = github_runtime_artifact(release, re.compile(r"win-cpu-x64\.zip$"))
        self.assertEqual(artifact.version, LLAMA_CPP_RELEASE)
        self.assertEqual(artifact.digest, "a" * 64)
        self.assertEqual(artifact.expected_size, 1234)

    def test_runtime_metadata_without_a_digest_fails_closed(self):
        release = {
            "tag_name": LLAMA_CPP_RELEASE,
            "assets": [
                {
                    "name": f"llama-{LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip",
                    "browser_download_url": "https://github.com/example/runtime.zip",
                    "size": 1234,
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            github_runtime_artifact(release, re.compile(r"win-cpu-x64\.zip$"))

    def test_model_tree_requires_safe_paths_and_content_digests(self):
        entries = [
            {
                "type": "file",
                "path": "weights/model.safetensors",
                "size": 12,
                "lfs": {"oid": "b" * 64},
            },
            {"type": "file", "path": "config.json", "size": 2, "oid": "c" * 40},
        ]
        artifacts = huggingface_artifacts("owner/model", entries, revision="d" * 40)
        self.assertEqual(artifacts["weights/model.safetensors"].digest_algorithm, "sha256")
        self.assertEqual(artifacts["config.json"].digest_algorithm, "git-sha1")
        for invalid in (
            "../outside",
            "/absolute",
            "C:/drive",
            "nested\\windows",
            "nested//alias",
            "nested/./alias",
            "NUL.txt",
            "name:stream",
        ):
            with self.subTest(path=invalid):
                with self.assertRaises(ValueError):
                    safe_relative_path(invalid)


class SafeArchiveTests(unittest.TestCase):
    def test_zip_extraction_rejects_traversal_before_writing_outside(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "runtime.zip"
            destination = root / "extracted"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../outside.exe", b"untrusted")
            with self.assertRaises(ValueError):
                extract_archive(archive, destination)
            self.assertFalse((root / "outside.exe").exists())

    def test_zip_extraction_rejects_symbolic_links(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "runtime.zip"
            link = zipfile.ZipInfo("llama-server")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(link, "outside")
            with self.assertRaisesRegex(ValueError, "links"):
                extract_archive(archive, root / "extracted")

    def test_zip_extraction_rejects_special_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "runtime.zip"
            fifo = zipfile.ZipInfo("llama-server")
            fifo.create_system = 3
            fifo.external_attr = (stat.S_IFIFO | 0o644) << 16
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(fifo, b"")
            with self.assertRaisesRegex(ValueError, "links"):
                extract_archive(archive, root / "extracted")

    def test_expected_runtime_binary_must_occur_exactly_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for relative in ("one/llama-server", "two/llama-server"):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"runtime")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                locate_expected_files(root, ("llama-server",))


class InstallAsyncTest(unittest.TestCase):
    """Each composed coordinator owns its asynchronous installation state."""

    def setUp(self):
        self.coordinator = InstallationCoordinator()

    def _start(self, runtime: str = "llamacpp") -> bool:
        return self.coordinator.start(
            lambda on_progress: installer.install(runtime, on_progress=on_progress)
        )

    def test_reports_progress_and_completion(self):
        started_event = threading.Event()

        def fake_install(runtime, *, on_progress=None, **kwargs):
            started_event.set()
            if on_progress:
                on_progress("Runtime", 50)

        with patch.object(installer, "install", fake_install):
            self.assertTrue(self._start())
            self.assertTrue(started_event.wait(timeout=2), "background thread never started")
            self._wait_until_idle()

        state = self.coordinator.read()
        self.assertFalse(state["running"])
        self.assertEqual(state["percent"], 100)
        self.assertEqual(state["error"], "")

    def test_second_call_while_running_is_a_no_op(self):
        release = threading.Event()

        def blocking_install(runtime, *, on_progress=None, **kwargs):
            release.wait(timeout=2)

        with patch.object(installer, "install", blocking_install):
            self.assertTrue(self._start())
            self._wait_until_running()
            self.assertFalse(self._start())
            release.set()
            self._wait_until_idle()

    def test_failure_is_reported_without_crashing(self):
        def failing_install(runtime, *, on_progress=None, **kwargs):
            raise SystemExit("no network")

        with patch.object(installer, "install", failing_install):
            self.assertTrue(self._start())
            self._wait_until_idle()

        state = self.coordinator.read()
        self.assertFalse(state["running"])
        self.assertIn("no network", state["error"])

    def _wait_until_idle(self, timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.coordinator.read()["running"]:
                return
            time.sleep(0.02)
        self.fail("install_async() never finished")

    def _wait_until_running(self, timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.coordinator.read()["running"]:
                return
            time.sleep(0.02)
        self.fail("install_async() never started")


if __name__ == "__main__":
    unittest.main()
