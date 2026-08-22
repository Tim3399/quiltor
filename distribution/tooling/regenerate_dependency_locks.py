#!/usr/bin/env python3
"""Regenerate target-specific, hash-pinned release dependency locks."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "distribution" / "dependency-locks.json"
TOOLCHAIN_PATH = REPO_ROOT / "distribution" / "toolchains.json"
UV_CACHE = REPO_ROOT / "distribution" / ".build" / "uv-cache"


class RegenerationError(RuntimeError):
    """The committed lock set cannot be reproduced by its declared generator."""


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_contracts() -> tuple[dict[str, object], dict[str, object]]:
    locks = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    toolchains = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8"))
    if locks.get("schemaVersion") != 2 or toolchains.get("schemaVersion") != 2:
        raise RegenerationError("unsupported dependency-lock or toolchain schema")
    return locks, toolchains


def _uv_executable(expected_version: str, override: Path | None = None) -> str:
    executable = (
        str(override.resolve())
        if override is not None
        else (shutil.which("uv") or shutil.which("uv.exe"))
    )
    if executable is None:
        raise RegenerationError(
            f"uv=={expected_version} is required; install that exact version before regenerating"
        )
    result = subprocess.run([executable, "--version"], capture_output=True, check=False, text=True)
    if result.returncode or result.stdout.strip().split()[:2] != ["uv", expected_version]:
        found = (result.stdout or result.stderr).strip() or "unavailable"
        raise RegenerationError(f"uv=={expected_version} is required; found {found}")
    return executable


def command_for(
    executable: str,
    record: dict[str, object],
    generator: dict[str, object],
    output: Path,
) -> list[str]:
    environment = record["pythonEnvironment"]
    if not isinstance(environment, dict):
        raise RegenerationError(f"{record.get('name')} has no Python environment")
    sources = record["sources"]
    extras = record["extras"]
    if not isinstance(sources, list) or not isinstance(extras, list):
        raise RegenerationError(f"{record.get('name')} has invalid resolver inputs")
    command = [
        executable,
        "--quiet",
        "pip",
        "compile",
        *(str(REPO_ROOT / str(source)) for source in sources),
        "--output-file",
        str(output),
        "--python-version",
        str(environment["version"]),
        "--python",
        sys.executable,
        "--no-managed-python",
        "--no-python-downloads",
        "--generate-hashes",
        "--no-annotate",
        "--no-header",
        "--no-sources",
        "--resolution",
        "highest",
        "--exclude-newer",
        str(generator["excludeNewer"]),
        "--cache-dir",
        str(UV_CACHE),
    ]
    if generator.get("onlyBinary") is True:
        command.extend(("--only-binary", ":all:"))
    python_platform = str(record["pythonPlatform"])
    if python_platform != "platform-independent":
        command.extend(("--python-platform", python_platform))
    for extra in extras:
        command.extend(("--extra", str(extra)))
    return command


def regenerate(*, check: bool, uv_path: Path | None = None) -> None:
    contract, toolchains = _load_contracts()
    generator = contract["generator"]
    lock_generator = toolchains["dependencyLockGenerator"]
    if not isinstance(generator, dict) or not isinstance(lock_generator, dict):
        raise RegenerationError("dependency-lock generator contract is invalid")
    expected_version = str(lock_generator.get("uv"))
    if generator.get("tool") != "uv" or generator.get("version") != expected_version:
        raise RegenerationError("dependency-lock and toolchain generator versions disagree")
    executable = _uv_executable(expected_version, uv_path)
    records = contract["locks"]
    if not isinstance(records, list):
        raise RegenerationError("dependency-lock records are invalid")

    with TemporaryDirectory(prefix="quiltor-dependency-locks-") as directory:
        generated_root = Path(directory)
        generated: list[tuple[dict[str, object], Path, Path]] = []
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                raise RegenerationError("dependency-lock record is invalid")
            destination = REPO_ROOT / str(record["path"])
            temporary = generated_root / f"{index}-{destination.name}"
            result = subprocess.run(
                command_for(executable, record, generator, temporary),
                cwd=REPO_ROOT,
                check=False,
            )
            if result.returncode:
                raise RegenerationError(f"uv failed while resolving {record['name']}")
            generated.append((record, temporary, destination))

        mismatches = [
            str(destination.relative_to(REPO_ROOT))
            for _, source, destination in generated
            if not destination.is_file() or source.read_bytes() != destination.read_bytes()
        ]
        if check:
            if mismatches:
                raise RegenerationError(
                    "generated dependency locks differ: " + ", ".join(mismatches)
                )
            return

        for record, source, destination in generated:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            record["sha256"] = _sha256(destination)
        CONTRACT_PATH.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare without writing")
    parser.add_argument("--uv", type=Path, help="path to the exact uv executable")
    arguments = parser.parse_args(argv)
    try:
        regenerate(check=arguments.check, uv_path=arguments.uv)
    except (OSError, KeyError, RegenerationError, TypeError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("Dependency locks are reproducible." if arguments.check else "Dependency locks updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
