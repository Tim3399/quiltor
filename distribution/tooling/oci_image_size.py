#!/usr/bin/env python3
"""Enforce compressed OCI runtime-image budgets against immutable registry data."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

REPO_ROOT = Path(__file__).resolve().parents[2]
BUDGET_CONTRACT = REPO_ROOT / "distribution" / "containers" / "image-size-budgets.json"

OCI_INDEX_MEDIA_TYPES = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}
OCI_MANIFEST_MEDIA_TYPES = {
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
}
ATTESTATION_REFERENCE_TYPE = "attestation-manifest"
DIGEST = re.compile(r"[A-Za-z][A-Za-z0-9_+.-]*:[A-Za-z0-9=_-]+")
IMMUTABLE_IMAGE_REFERENCE = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
RawInspector = Callable[[str], dict[str, object]]


class ImageSizeError(ValueError):
    """The registry data or committed budget cannot be measured safely."""


@dataclass(frozen=True)
class ImageBudget:
    name: str
    os: str
    architecture: str
    max_compressed_bytes: int


@dataclass(frozen=True)
class RuntimeImageSize:
    manifest_digest: str
    config_bytes: int
    layer_bytes: int
    layer_count: int

    @property
    def compressed_bytes(self) -> int:
        return self.config_bytes + self.layer_bytes


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ImageSizeError(f"{label} must be a JSON object")
    return value


def _array(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise ImageSizeError(f"{label} must be a JSON array")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ImageSizeError(f"{label} must be a non-empty string")
    return value


def _size(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ImageSizeError(f"{label} must be a non-negative integer")
    return value


def _digest(value: object, label: str) -> str:
    digest = _string(value, label)
    if DIGEST.fullmatch(digest) is None:
        raise ImageSizeError(f"{label} is not a valid OCI digest")
    return digest


def load_budget(name: str, path: Path = BUDGET_CONTRACT) -> ImageBudget:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ImageSizeError(f"invalid image-size budget contract {path}: {error}") from error
    root = _object(document, "image-size budget contract")
    if root.get("schemaVersion") != 1 or set(root) != {"schemaVersion", "images"}:
        raise ImageSizeError("image-size budget contract must use exactly schemaVersion 1")
    images = _object(root["images"], "image-size budget images")
    if name not in images:
        raise ImageSizeError(f"image-size budget {name!r} is not declared")
    record = _object(images[name], f"image-size budget {name!r}")
    if set(record) != {"platform", "maxCompressedBytes"}:
        raise ImageSizeError(f"image-size budget {name!r} has unexpected fields")
    platform = _object(record["platform"], f"image-size budget {name!r} platform")
    if set(platform) != {"os", "architecture"}:
        raise ImageSizeError(f"image-size budget {name!r} platform has unexpected fields")
    maximum = _size(record["maxCompressedBytes"], f"image-size budget {name!r} maximum")
    if maximum == 0:
        raise ImageSizeError(f"image-size budget {name!r} maximum must be positive")
    return ImageBudget(
        name=name,
        os=_string(platform["os"], f"image-size budget {name!r} operating system"),
        architecture=_string(platform["architecture"], f"image-size budget {name!r} architecture"),
        max_compressed_bytes=maximum,
    )


def _repository(reference: str) -> str:
    if not reference or any(character.isspace() for character in reference):
        raise ImageSizeError("image reference must be non-empty and contain no whitespace")
    without_digest = reference.split("@", 1)[0]
    prefix, separator, leaf = without_digest.rpartition("/")
    if ":" in leaf:
        leaf = leaf.split(":", 1)[0]
    repository = f"{prefix}{separator}{leaf}"
    if not leaf:
        raise ImageSizeError(f"cannot derive a repository from image reference {reference!r}")
    return repository


def docker_imagetools_raw(reference: str) -> dict[str, object]:
    command = ["docker", "buildx", "imagetools", "inspect", "--raw", reference]
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError as error:
        raise ImageSizeError(f"cannot run Docker Buildx: {error}") from error
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "unknown Docker error"
        raise ImageSizeError(f"cannot inspect {reference}: {detail}")
    try:
        document = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ImageSizeError(f"Docker returned invalid JSON for {reference}: {error}") from error
    return _object(document, f"OCI document for {reference}")


def _is_attestation(descriptor: dict[str, object]) -> bool:
    annotations = descriptor.get("annotations")
    if isinstance(annotations, dict) and (
        annotations.get("vnd.docker.reference.type") == ATTESTATION_REFERENCE_TYPE
    ):
        return True
    artifact_type = descriptor.get("artifactType")
    return isinstance(artifact_type, str) and (
        "in-toto" in artifact_type.casefold() or "attestation" in artifact_type.casefold()
    )


def select_runtime_manifest(
    index: dict[str, object], *, os_name: str, architecture: str
) -> dict[str, object]:
    media_type = index.get("mediaType")
    if media_type not in OCI_INDEX_MEDIA_TYPES:
        raise ImageSizeError(f"expected an OCI image index, got media type {media_type!r}")
    candidates: list[dict[str, object]] = []
    for number, raw_descriptor in enumerate(_array(index.get("manifests"), "OCI manifests")):
        descriptor = _object(raw_descriptor, f"OCI manifest descriptor {number}")
        if _is_attestation(descriptor):
            continue
        platform = descriptor.get("platform")
        if not isinstance(platform, dict):
            continue
        if platform.get("os") == os_name and platform.get("architecture") == architecture:
            candidates.append(descriptor)
    if len(candidates) != 1:
        raise ImageSizeError(
            f"expected exactly one non-attestation {os_name}/{architecture} runtime manifest, "
            f"found {len(candidates)}"
        )
    descriptor = candidates[0]
    _digest(descriptor.get("digest"), "runtime manifest digest")
    if descriptor.get("mediaType") not in OCI_MANIFEST_MEDIA_TYPES:
        raise ImageSizeError("selected runtime descriptor is not an OCI/Docker image manifest")
    return descriptor


def compressed_runtime_size(
    image_reference: str,
    *,
    os_name: str,
    architecture: str,
    inspect_raw: RawInspector = docker_imagetools_raw,
) -> RuntimeImageSize:
    if IMMUTABLE_IMAGE_REFERENCE.fullmatch(image_reference) is None:
        raise ImageSizeError(
            "image reference must be bound to an immutable @sha256:<64 lowercase hex> digest"
        )
    index = inspect_raw(image_reference)
    descriptor = select_runtime_manifest(index, os_name=os_name, architecture=architecture)
    manifest_digest = _digest(descriptor.get("digest"), "runtime manifest digest")
    manifest_reference = f"{_repository(image_reference)}@{manifest_digest}"
    manifest = inspect_raw(manifest_reference)
    if manifest.get("mediaType") not in OCI_MANIFEST_MEDIA_TYPES:
        raise ImageSizeError("selected runtime document is not an OCI/Docker image manifest")

    config = _object(manifest.get("config"), "runtime image config")
    _digest(config.get("digest"), "runtime image config digest")
    config_bytes = _size(config.get("size"), "runtime image config size")

    layer_sizes: dict[str, int] = {}
    for number, raw_layer in enumerate(_array(manifest.get("layers"), "runtime image layers")):
        layer = _object(raw_layer, f"runtime image layer {number}")
        digest = _digest(layer.get("digest"), f"runtime image layer {number} digest")
        size = _size(layer.get("size"), f"runtime image layer {number} size")
        previous = layer_sizes.get(digest)
        if previous is not None and previous != size:
            raise ImageSizeError(f"runtime layer {digest} declares conflicting compressed sizes")
        layer_sizes[digest] = size

    return RuntimeImageSize(
        manifest_digest=manifest_digest,
        config_bytes=config_bytes,
        layer_bytes=sum(layer_sizes.values()),
        layer_count=len(layer_sizes),
    )


def format_mib(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MiB"


def check(image_reference: str, budget: ImageBudget) -> RuntimeImageSize:
    measured = compressed_runtime_size(
        image_reference,
        os_name=budget.os,
        architecture=budget.architecture,
    )
    if measured.compressed_bytes > budget.max_compressed_bytes:
        excess = measured.compressed_bytes - budget.max_compressed_bytes
        raise ImageSizeError(
            f"{budget.name} {budget.os}/{budget.architecture} compressed runtime is "
            f"{format_mib(measured.compressed_bytes)}, exceeding its "
            f"{format_mib(budget.max_compressed_bytes)} budget by {format_mib(excess)}"
        )
    return measured


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check",))
    parser.add_argument("image", help="immutable OCI index/tag reference to inspect")
    parser.add_argument("--budget", default="web", help="budget name in the central contract")
    parser.add_argument("--contract", type=Path, default=BUDGET_CONTRACT)
    arguments = parser.parse_args(argv)
    try:
        budget = load_budget(arguments.budget, arguments.contract)
        measured = check(arguments.image, budget)
    except ImageSizeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(
        f"{budget.name} {budget.os}/{budget.architecture}: "
        f"{format_mib(measured.compressed_bytes)} compressed "
        f"({format_mib(measured.config_bytes)} config + "
        f"{format_mib(measured.layer_bytes)} across {measured.layer_count} unique layers); "
        f"budget {format_mib(budget.max_compressed_bytes)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
