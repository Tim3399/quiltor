"""Compressed OCI runtime-image budget tests."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLING = REPO_ROOT / "distribution" / "tooling"
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "oci"
sys.path.insert(0, str(TOOLING))

import oci_image_size  # noqa: E402
import workflow_contract  # noqa: E402


def fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class OciImageSizeTests(unittest.TestCase):
    def setUp(self):
        self.index = fixture("web-index.json")
        self.runtime = fixture("web-linux-amd64-manifest.json")

    def test_central_web_budget_is_linux_amd64_and_550_mib(self):
        budget = oci_image_size.load_budget("web")
        self.assertEqual((budget.os, budget.architecture), ("linux", "amd64"))
        self.assertEqual(budget.max_compressed_bytes, 550 * 1024 * 1024)

    def test_selects_amd64_runtime_excludes_attestation_and_deduplicates_layers(self):
        inspected = []

        def inspect(reference):
            inspected.append(reference)
            return self.index if len(inspected) == 1 else self.runtime

        measured = oci_image_size.compressed_runtime_size(
            "registry.example:5000/team/quiltor@sha256:" + "a" * 64,
            os_name="linux",
            architecture="amd64",
            inspect_raw=inspect,
        )

        self.assertEqual(
            inspected,
            [
                "registry.example:5000/team/quiltor@sha256:" + "a" * 64,
                "registry.example:5000/team/quiltor@sha256:" + "b" * 64,
            ],
        )
        self.assertEqual(measured.config_bytes, 100)
        self.assertEqual(measured.layer_bytes, 500)
        self.assertEqual(measured.layer_count, 2)
        self.assertEqual(measured.compressed_bytes, 600)

    def test_fails_closed_when_runtime_platform_is_missing_or_ambiguous(self):
        missing = copy.deepcopy(self.index)
        missing["manifests"][1]["platform"]["architecture"] = "s390x"
        with self.assertRaisesRegex(oci_image_size.ImageSizeError, "found 0"):
            oci_image_size.select_runtime_manifest(missing, os_name="linux", architecture="amd64")

        ambiguous = copy.deepcopy(self.index)
        duplicate = copy.deepcopy(ambiguous["manifests"][1])
        duplicate["digest"] = "sha256:" + "9" * 64
        ambiguous["manifests"].append(duplicate)
        with self.assertRaisesRegex(oci_image_size.ImageSizeError, "found 2"):
            oci_image_size.select_runtime_manifest(ambiguous, os_name="linux", architecture="amd64")

    def test_rejects_conflicting_sizes_for_a_duplicate_layer_digest(self):
        runtime = copy.deepcopy(self.runtime)
        runtime["layers"][2]["size"] = 201

        def inspect(reference):
            return self.index if reference.endswith("a" * 64) else runtime

        with self.assertRaisesRegex(oci_image_size.ImageSizeError, "conflicting"):
            oci_image_size.compressed_runtime_size(
                "ghcr.io/example/quiltor@sha256:" + "a" * 64,
                os_name="linux",
                architecture="amd64",
                inspect_raw=inspect,
            )

    def test_rejects_mutable_or_malformed_image_references_before_registry_access(self):
        inspect = Mock()
        for reference in (
            "ghcr.io/example/quiltor:build-1",
            "ghcr.io/example/quiltor@sha256:123",
            "ghcr.io/example/quiltor@sha256:" + "A" * 64,
        ):
            with self.subTest(reference=reference):
                with self.assertRaisesRegex(oci_image_size.ImageSizeError, "immutable"):
                    oci_image_size.compressed_runtime_size(
                        reference,
                        os_name="linux",
                        architecture="amd64",
                        inspect_raw=inspect,
                    )
        inspect.assert_not_called()

    def test_docker_inspection_uses_structured_arguments_and_parses_json(self):
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps(self.index), stderr=""
        )
        with patch("oci_image_size.subprocess.run", return_value=completed) as run:
            result = oci_image_size.docker_imagetools_raw(
                "ghcr.io/example/quiltor@sha256:" + "1" * 64
            )
        self.assertEqual(result, self.index)
        run.assert_called_once_with(
            [
                "docker",
                "buildx",
                "imagetools",
                "inspect",
                "--raw",
                "ghcr.io/example/quiltor@sha256:" + "1" * 64,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_budget_failure_reports_actual_limit_and_excess(self):
        budget = oci_image_size.ImageBudget("web", "linux", "amd64", 599)
        with patch(
            "oci_image_size.compressed_runtime_size",
            return_value=oci_image_size.RuntimeImageSize("sha256:" + "b" * 64, 100, 500, 2),
        ):
            with self.assertRaisesRegex(
                oci_image_size.ImageSizeError, "exceeding its .* budget by"
            ):
                oci_image_size.check("ghcr.io/example/quiltor@sha256:root", budget)

    def test_malformed_budget_contract_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "budgets.json"
            path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "images": {
                            "web": {
                                "platform": {"os": "linux", "architecture": "amd64"},
                                "maxCompressedBytes": 0,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(oci_image_size.ImageSizeError, "positive"):
                oci_image_size.load_budget("web", path)

    def test_release_workflow_guards_the_immutable_pushed_web_image(self):
        build_path = REPO_ROOT / ".github" / "workflows" / "release.yml"
        sources = {build_path: build_path.read_text(encoding="utf-8")}
        workflow_contract.validate_image_size_guard(sources)

        mutable = sources[build_path].replace(
            "IMAGE: ${{ steps.immutable.outputs.value }}", "IMAGE: ${{ steps.image.outputs.tag }}"
        )
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "immutable"):
            workflow_contract.validate_image_size_guard({build_path: mutable})

        bypassable = sources[build_path].replace(
            "        env:\n          IMAGE: ${{ steps.immutable.outputs.value }}",
            "        continue-on-error: true\n"
            "        env:\n          IMAGE: ${{ steps.immutable.outputs.value }}",
            1,
        )
        self.assertNotEqual(bypassable, sources[build_path])
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "continue on error"):
            workflow_contract.validate_image_size_guard({build_path: bypassable})


if __name__ == "__main__":
    unittest.main()
