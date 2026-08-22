#!/usr/bin/env python3
"""Raise Quiltor's version in every package manifest that has to agree.

    python distribution/tooling/set_version.py 2.15.0
    python distribution/tooling/set_version.py minor

`VERSION` is the single source of truth every build reads, but it is not the
only place the number lives: `package.json` carries its own copy and
`package-lock.json` two more (its root `version` and `packages[""].version`),
the Rust workspace inherits its version from `Cargo.toml`, and `Cargo.lock`
records both local crates.
They are not decoration -- release.yml's version-check job fails the release
outright when VERSION and package.json disagree, and `npm ci` refuses to run at
all when package.json and its lockfile do. Seven values kept identical by hand
is the kind of thing that fails once and costs a release cycle, so this exists
to make raising the version one command.

Three refusals, all about the same failure mode -- a release that looks like it
worked and did not:

* **A dirty working tree.** The version bump wants to be one small reviewable
  commit; mixed into unrelated edits, nobody can see at a glance that all five
  files moved together. Commit or stash first.
* **A version that is not strictly ahead** of the current one. Re-releasing an
  existing version fails the release identity gate because the tag already
  exists.
* **A release gate that does not pass.** Backend and frontend tests, the
  production web build, its committed `dist/` output, browser suite, wheel,
  sdist and both container builds all run before any version file is touched.

All five target byte streams are calculated and validated before staged files
replace any target; a failed replacement rolls the transaction back. Reviewing
and committing the diff stays a deliberate act, and pushing it to main is what
starts a release.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

from release_preflight import PreflightError, run_preflight

REPO_ROOT = Path(__file__).resolve().parents[2]

#: The package manifests, in the order the message prints them.
VERSION_FILE = "VERSION"
PACKAGE_JSON = "package.json"
PACKAGE_LOCK = "package-lock.json"
CARGO_TOML = "Cargo.toml"
CARGO_LOCK = "Cargo.lock"

BUMPS = ("major", "minor", "patch")


def parse_version(text: str) -> tuple[int, int, int]:
    """major.minor.patch as integers, so versions compare as numbers.

    String comparison would order 2.9.0 after 2.10.0 and let a "bump" go
    backwards -- which is exactly the mistake the ahead-of-current check
    exists to catch, so it must not be made here.
    """

    parts = text.strip().split(".")

    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(
            f"{text!r} is not a version. Expected three integers separated by dots, "
            f"e.g. 2.15.0, or one of: {', '.join(BUMPS)}."
        )

    return tuple(int(part) for part in parts)  # type: ignore[return-value]


def format_version(parts: tuple[int, int, int]) -> str:
    return ".".join(str(part) for part in parts)


def next_version(current: str, request: str) -> str:
    """The version `request` asks for, given `current`.

    `request` is either a literal version or one of major/minor/patch.
    """

    major, minor, patch = parse_version(current)

    if request == "major":
        return format_version((major + 1, 0, 0))

    if request == "minor":
        return format_version((major, minor + 1, 0))

    if request == "patch":
        return format_version((major, minor, patch + 1))

    return format_version(parse_version(request))


def current_version(repo_root: Path = REPO_ROOT) -> str:
    """From VERSION, which is the source of truth the others copy."""

    return (repo_root / VERSION_FILE).read_text(encoding="utf-8").strip()


def uncommitted_changes(repo_root: Path = REPO_ROOT) -> list[str]:
    """Porcelain status lines, empty on a clean tree.

    Untracked files count. They are not noise here: `distribution/artifacts/`, the
    desktop venv and the build directories are all gitignored already, so
    anything that does show up is a real file somebody has not decided about
    yet.
    """

    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )

    return [line for line in result.stdout.splitlines() if line.strip()]


TARGET_FILES = [VERSION_FILE, PACKAGE_JSON, PACKAGE_LOCK, CARGO_TOML, CARGO_LOCK]


def _json_bytes(value: object) -> bytes:
    """Use npm's two-space JSON format and LF on every platform."""

    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _read_targets(repo_root: Path) -> dict[str, bytes]:
    originals: dict[str, bytes] = {}
    for name in TARGET_FILES:
        path = repo_root / name
        try:
            originals[name] = path.read_bytes()
        except OSError as error:
            raise ValueError(f"cannot read version target {name}: {error}") from error
    return originals


def _render_targets(version: str, originals: dict[str, bytes]) -> dict[str, bytes]:
    """Calculate and validate every target byte before the filesystem is touched."""

    parse_version(version)
    try:
        package = json.loads(originals[PACKAGE_JSON].decode("utf-8"))
        package_lock = json.loads(originals[PACKAGE_LOCK].decode("utf-8"))
        cargo = originals[CARGO_TOML].decode("utf-8").replace("\r\n", "\n")
        cargo_lock = originals[CARGO_LOCK].decode("utf-8").replace("\r\n", "\n")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"a version target cannot be parsed: {error}") from error

    if not isinstance(package, dict) or "version" not in package:
        raise ValueError("package.json needs one top-level version")
    if not isinstance(package_lock, dict) or "version" not in package_lock:
        raise ValueError("package-lock.json needs one top-level version")
    packages = package_lock.get("packages")
    if not isinstance(packages, dict) or not isinstance(packages.get(""), dict):
        raise ValueError('package-lock.json needs a packages[""] object')
    if "version" not in packages[""]:
        raise ValueError('package-lock.json packages[""] needs one version')
    package["version"] = version
    package_lock["version"] = version
    packages[""]["version"] = version

    workspace_marker = "[workspace.package]"
    if cargo.count(workspace_marker) != 1:
        raise ValueError("Cargo.toml must contain exactly one [workspace.package] table")
    before, workspace = cargo.split(workspace_marker, 1)
    rewritten_workspace, replacements = re.subn(
        r'(?m)^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"\s*$',
        f'version = "{version}"',
        workspace,
        count=1,
    )
    if replacements != 1:
        raise ValueError("Cargo.toml [workspace.package] needs one semantic version")
    rewritten_cargo = before + workspace_marker + rewritten_workspace

    rewritten_lock = cargo_lock
    for package_name in ("quiltor-core", "quiltor-ffi"):
        pattern = rf'(\[\[package\]\]\nname = "{re.escape(package_name)}"\nversion = ")[^"]+("\n)'
        rewritten_lock, replacements = re.subn(pattern, rf"\g<1>{version}\g<2>", rewritten_lock)
        if replacements != 1:
            raise ValueError(f"Cargo.lock must contain exactly one {package_name} package")

    rendered = {
        VERSION_FILE: (version + "\n").encode("utf-8"),
        PACKAGE_JSON: _json_bytes(package),
        PACKAGE_LOCK: _json_bytes(package_lock),
        CARGO_TOML: rewritten_cargo.encode("utf-8"),
        CARGO_LOCK: rewritten_lock.encode("utf-8"),
    }
    _validate_rendered(version, rendered)
    return rendered


def _validate_rendered(version: str, rendered: dict[str, bytes]) -> None:
    if set(rendered) != set(TARGET_FILES):
        raise ValueError("the atomic version transaction is missing a target")
    if rendered[VERSION_FILE].decode("utf-8").strip() != version:
        raise ValueError("rendered VERSION does not match the requested version")
    package = json.loads(rendered[PACKAGE_JSON].decode("utf-8"))
    lock = json.loads(rendered[PACKAGE_LOCK].decode("utf-8"))
    cargo = tomllib.loads(rendered[CARGO_TOML].decode("utf-8"))
    cargo_lock = tomllib.loads(rendered[CARGO_LOCK].decode("utf-8"))
    local_crates = {
        entry.get("name"): entry.get("version")
        for entry in cargo_lock.get("package", [])
        if entry.get("name") in {"quiltor-core", "quiltor-ffi"}
    }
    copies = {
        package.get("version"),
        lock.get("version"),
        lock.get("packages", {}).get("", {}).get("version"),
        cargo.get("workspace", {}).get("package", {}).get("version"),
        local_crates.get("quiltor-core"),
        local_crates.get("quiltor-ffi"),
    }
    if copies != {version}:
        raise ValueError("rendered version targets do not agree")


def _stage_bytes(path: Path, content: bytes) -> Path:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.set-version-", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def _replace(source: Path, destination: Path) -> None:
    os.replace(source, destination)


def _commit_targets(
    repo_root: Path, rendered: dict[str, bytes], originals: dict[str, bytes]
) -> None:
    staged: dict[str, Path] = {}
    replaced: list[str] = []
    try:
        for name in TARGET_FILES:
            staged[name] = _stage_bytes(repo_root / name, rendered[name])
        for name in TARGET_FILES:
            if (repo_root / name).read_bytes() != originals[name]:
                raise ValueError(f"version target changed during transaction: {name}")
        for name in TARGET_FILES:
            _replace(staged[name], repo_root / name)
            replaced.append(name)
    except Exception as error:
        rollback_errors: list[str] = []
        for name in reversed(replaced):
            rollback: Path | None = None
            try:
                rollback = _stage_bytes(repo_root / name, originals[name])
                _replace(rollback, repo_root / name)
            except Exception as rollback_error:  # pragma: no cover - catastrophic filesystem fault
                rollback_errors.append(f"{name}: {rollback_error}")
            finally:
                if rollback is not None:
                    try:
                        rollback.unlink(missing_ok=True)
                    except OSError:
                        pass
        if rollback_errors:
            raise RuntimeError(
                "version transaction failed and rollback was incomplete: "
                + "; ".join(rollback_errors)
            ) from error
        raise
    finally:
        for temporary in staged.values():
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def apply_version(version: str, repo_root: Path = REPO_ROOT) -> list[str]:
    """Atomically write one validated version transaction across all ecosystems."""

    originals = _read_targets(repo_root)
    rendered = _render_targets(version, originals)
    _commit_targets(repo_root, rendered, originals)
    return TARGET_FILES.copy()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="distribution/tooling/set_version.py",
        description=("Raise VERSION, npm manifests and the Cargo workspace version together."),
        epilog="Pushing the resulting commit to main is what triggers a release.",
    )

    parser.add_argument(
        "version",
        help=(f"an explicit version such as 2.15.0, or one of: {', '.join(BUMPS)}"),
    )

    args = parser.parse_args(argv)

    repo_root = REPO_ROOT
    current = current_version(repo_root)

    try:
        target = next_version(
            current,
            args.version,
        )
    except ValueError as error:
        print(
            f"error: {error}",
            file=sys.stderr,
        )

        return 2

    if parse_version(target) <= parse_version(current):
        print(
            f"error: {target} is not ahead of the current version {current}.",
            file=sys.stderr,
        )

        print(
            "       Release versions are immutable and must move forward.",
            file=sys.stderr,
        )

        print(
            "       The release identity gate also rejects an existing version tag.",
            file=sys.stderr,
        )

        return 1

    dirty = uncommitted_changes(repo_root)

    if dirty:
        print(
            "error: the working tree has uncommitted changes.",
            file=sys.stderr,
        )

        print(
            "       A version bump should be one reviewable commit of its own.",
            file=sys.stderr,
        )

        print(
            "       Commit or stash these first:",
            file=sys.stderr,
        )

        for line in dirty[:10]:
            print(
                f"         {line}",
                file=sys.stderr,
            )

        if len(dirty) > 10:
            print(
                f"         ... and {len(dirty) - 10} more",
                file=sys.stderr,
            )

        return 1

    try:
        run_preflight(repo_root)
    except PreflightError as error:
        print(
            f"error: version unchanged because the release preflight failed: {error}",
            file=sys.stderr,
        )
        return 1

    try:
        written = apply_version(
            target,
            repo_root,
        )
    except (OSError, ValueError) as error:
        print(
            f"error: version unchanged because the atomic update failed: {error}",
            file=sys.stderr,
        )
        return 1
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"{current} -> {target}")

    for name in written:
        print(f"  updated {name}")

    print()
    print("Next: review the diff, commit it, and merge it to main.")

    print(f"  git commit -m 'chore: release v{target}' -- {' '.join(written)}")

    print("Pushing that to main is what runs .github/workflows/release.yml.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
