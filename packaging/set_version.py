#!/usr/bin/env python3
"""Raise Quiltor's version in the three files that have to agree.

    python3 packaging/set_version.py 2.15.0     # an explicit version
    python3 packaging/set_version.py minor      # or major / minor / patch

`VERSION` is the single source of truth every build reads, but it is not the
only place the number lives: `package.json` carries its own copy and
`package-lock.json` two more (its root `version` and `packages[""].version`).
They are not decoration -- release.yml's version-check job fails the release
outright when VERSION and package.json disagree, and `npm ci` refuses to run at
all when package.json and its lockfile do. Four numbers kept identical by hand
is the kind of thing that fails once and costs a release cycle, so this exists
to make raising the version one command.

Three refusals, all about the same failure mode -- a release that looks like it
worked and did not:

* **A dirty working tree.** The version bump wants to be one small reviewable
  commit; mixed into unrelated edits, nobody can see at a glance that all four
  numbers moved together. Commit or stash first.
* **A version that is not strictly ahead** of the current one. Re-releasing an
  existing version is not an error you find out about: release.yml sees the tag
  already exists, sets should_release=false, and every downstream job is
  skipped. The run is green and nothing shipped.
* **A release gate that does not pass.** Backend and frontend tests, the
  production web build, its committed `dist/` output and the browser suite all
  run before any version file is touched.

This writes the files and stops. Reviewing and committing the diff stays a
deliberate act, and pushing it to main is what starts a release.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from release_preflight import PreflightError, run_preflight

REPO_ROOT = Path(__file__).resolve().parent.parent

#: The three files, in the order the message prints them.
VERSION_FILE = "VERSION"
PACKAGE_JSON = "package.json"
PACKAGE_LOCK = "package-lock.json"

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

    Untracked files count. They are not noise here: `packaging/dist/`, the
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


def _write_text_lf(path: Path, content: str) -> None:
    """Write UTF-8 text with LF line endings on every platform."""

    path.write_text(
        content,
        encoding="utf-8",
        newline="\n",
    )


def _rewrite_json(path: Path, mutate) -> None:
    """Read, mutate and write a JSON file back in npm's own formatting.

    Two-space indent, UTF-8 rather than \\u escapes, trailing newline: that is
    byte-for-byte what npm writes, so touching one number produces a one- or
    two-line diff instead of reformatting the whole lockfile.

    LF is forced explicitly so running the script on Windows cannot turn the
    files into CRLF and subsequently fail the repository formatting check.

    tests/backend/test_packaging.py pins that round trip against the real
    files, so if npm ever changes its formatting the test says so rather than
    a surprise 3000-line diff.
    """

    data = json.loads(
        path.read_text(
            encoding="utf-8",
        )
    )

    mutate(data)

    _write_text_lf(
        path,
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
    )


def apply_version(
    version: str,
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    """Write `version` into all three files. Returns the names written."""

    parse_version(version)

    _write_text_lf(
        repo_root / VERSION_FILE,
        version + "\n",
    )

    def set_package_version(data):
        data["version"] = version

    def set_lock_version(data):
        # Both copies, always: npm reads the root one and compares
        # packages[""] against package.json. Updating only one is worse than
        # updating neither, because `npm ci` then fails somewhere unrelated.
        data["version"] = version
        data["packages"][""]["version"] = version

    _rewrite_json(
        repo_root / PACKAGE_JSON,
        set_package_version,
    )

    _rewrite_json(
        repo_root / PACKAGE_LOCK,
        set_lock_version,
    )

    return [
        VERSION_FILE,
        PACKAGE_JSON,
        PACKAGE_LOCK,
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="packaging/set_version.py",
        description=("Raise the version in VERSION, package.json and package-lock.json together."),
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
            "       Re-releasing an existing version does not fail the release workflow --",
            file=sys.stderr,
        )

        print(
            "       it finds the tag already exists and skips every job, green and empty.",
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

    written = apply_version(
        target,
        repo_root,
    )

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
