#!/usr/bin/env python3
"""
Decide which job groups of test.yml a pull request needs, from the paths it changes.

    path_filter.py plan --merge <rev> [--repository <dir>] [--output <file>]
    path_filter.py plan --base <rev> --head <rev> [--repository <dir>] [--output <file>]
    path_filter.py check

`plan` runs in the plan job of test.yml and writes one `run_<group>=true|false` line per
group. It is fail-safe: a path no rule knows, an empty change list, or a diff that cannot be
read makes every group true. Only a successful run over known paths can switch a group off.

`check` validates .github/test-paths.json against `git ls-files`: every tracked file falls in
at least one rule or in a justified untested entry. workflow_contract.py calls the same code.

Standard library only: the plan job runs it before any dependency is installed. It runs the
copy from the pull request's base, next to the base's configuration, and points --repository at
the checkout, so a pull request cannot change the rules it is judged by.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / ".github" / "test-paths.json"
GROUP_NAME = re.compile(r"[a-z][a-z0-9]*")


class PathFilterError(ValueError):
    """The path configuration is incomplete, ambiguous or unjustified."""


@dataclass(frozen=True)
class Rule:
    name: str
    patterns: tuple[str, ...]
    groups: frozenset[str]
    reason: str


@dataclass(frozen=True)
class Config:
    groups: tuple[str, ...]
    rules: tuple[Rule, ...]
    untested: tuple[Rule, ...]


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    """
    A repository glob as a regex over a slash-separated path.

    `*` and `?` stay inside one path segment, `**/` matches any number of directories
    (also none), and a trailing `**` matches everything below. There is no other syntax:
    a bracket or a brace is refused rather than read some way the author did not mean.
    """

    if not pattern or pattern.startswith("/") or "\\" in pattern:
        raise PathFilterError(f"invalid pattern {pattern!r}: relative, slash-separated paths only")
    if re.search(r"[\[\]{}!]", pattern):
        raise PathFilterError(f"invalid pattern {pattern!r}: only *, ** and ? are supported")
    out = []
    index = 0
    while index < len(pattern):
        if pattern.startswith("**/", index):
            if index and pattern[index - 1] != "/":
                raise PathFilterError(f"invalid pattern {pattern!r}: ** must be a whole segment")
            out.append("(?:[^/]+/)*")
            index += 3
        elif pattern.startswith("**", index):
            if index + 2 != len(pattern) or (index and pattern[index - 1] != "/"):
                raise PathFilterError(f"invalid pattern {pattern!r}: ** must be a whole segment")
            out.append(".*")
            index += 2
        elif pattern[index] == "*":
            out.append("[^/]*")
            index += 1
        elif pattern[index] == "?":
            out.append("[^/]")
            index += 1
        else:
            out.append(re.escape(pattern[index]))
            index += 1
    return re.compile("".join(out))


def _matches(rule: Rule, path: str) -> bool:
    return any(glob_to_regex(pattern).fullmatch(path) for pattern in rule.patterns)


def _reason(entry: dict[str, object], where: str) -> str:
    reason = entry.get("reason")
    if not isinstance(reason, str) or len(reason.strip()) < 10:
        raise PathFilterError(f"{where} needs a reason of at least a short sentence")
    return reason.strip()


def _patterns(entry: dict[str, object], where: str) -> tuple[str, ...]:
    patterns = entry.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        raise PathFilterError(f"{where} needs a non-empty list of patterns")
    for pattern in patterns:
        if not isinstance(pattern, str):
            raise PathFilterError(f"{where} has a pattern that is not a string")
        glob_to_regex(pattern)
    return tuple(patterns)


def parse_config(document: object) -> Config:
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise PathFilterError("unsupported test-paths schema")
    groups = document.get("groups")
    if not isinstance(groups, dict) or not groups:
        raise PathFilterError("test-paths.json declares no groups")
    for name, description in groups.items():
        if not GROUP_NAME.fullmatch(name) or not isinstance(description, str) or not description:
            raise PathFilterError(f"group {name!r} needs a lowercase name and a description")
    rules = []
    for index, entry in enumerate(document.get("rules") or []):
        if not isinstance(entry, dict):
            raise PathFilterError(f"rule {index} is not an object")
        name = entry.get("name")
        where = f"rule {name or index}"
        if not isinstance(name, str) or not name:
            raise PathFilterError(f"rule {index} needs a name")
        selected = entry.get("groups")
        if not isinstance(selected, list) or not selected:
            raise PathFilterError(f"{where} selects no group; use an untested entry instead")
        unknown = set(selected) - set(groups)
        if unknown:
            raise PathFilterError(f"{where} names unknown groups: {', '.join(sorted(unknown))}")
        rules.append(
            Rule(name, _patterns(entry, where), frozenset(selected), _reason(entry, where))
        )
    if not rules:
        raise PathFilterError("test-paths.json has no rules")
    untested = []
    for index, entry in enumerate(document.get("untested") or []):
        if not isinstance(entry, dict):
            raise PathFilterError(f"untested entry {index} is not an object")
        where = f"untested entry {index}"
        if "groups" in entry:
            raise PathFilterError(f"{where} selects groups; it belongs in the rules")
        untested.append(
            Rule("untested", _patterns(entry, where), frozenset(), _reason(entry, where))
        )
    return Config(tuple(groups), tuple(rules), tuple(untested))


def load_config(path: Path = CONFIG) -> Config:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PathFilterError(f"cannot read {path}: {error}") from error
    return parse_config(document)


def everything(config: Config) -> dict[str, bool]:
    return dict.fromkeys(config.groups, True)


def plan(config: Config, paths: Iterable[str]) -> tuple[dict[str, bool], list[str]]:
    """
    The groups a change list needs, and the paths that made it run everything.

    The second value is empty unless a path is unknown or the list is empty, in which case
    every group is selected and it names why.
    """

    paths = [path for path in paths if path]
    if not paths:
        return everything(config), ["<no changed paths>"]
    selected: set[str] = set()
    unknown = []
    for path in paths:
        hits = [rule for rule in config.rules if _matches(rule, path)]
        if hits:
            for rule in hits:
                selected |= rule.groups
        elif not any(_matches(entry, path) for entry in config.untested):
            unknown.append(path)
    if unknown:
        return everything(config), unknown
    return {group: group in selected for group in config.groups}, []


def coverage_errors(config: Config, tracked: Sequence[str]) -> list[str]:
    """Every tracked file is covered exactly one way, and no entry is dead."""

    errors = []
    used: set[int] = set()
    for path in tracked:
        rules = [index for index, rule in enumerate(config.rules) if _matches(rule, path)]
        skips = [index for index, entry in enumerate(config.untested) if _matches(entry, path)]
        used.update(rules)
        used.update(len(config.rules) + index for index in skips)
        if not rules and not skips:
            errors.append(f"{path} falls in no group and is not listed as untested")
        elif rules and skips:
            errors.append(f"{path} is both tested and listed as untested")
    for index, entry in enumerate(config.rules + config.untested):
        if index not in used:
            label = (
                entry.name
                if index < len(config.rules)
                else f"untested entry {index - len(config.rules)}"
            )
            errors.append(f"{label} matches no tracked file")
    return errors


def changed_paths(base: str, head: str, cwd: Path | None = None) -> list[str]:
    """Paths between two commits; a rename counts as its old and its new path."""

    result = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, head],
        cwd=cwd or REPO_ROOT,
        capture_output=True,
        check=True,
    )
    return [path for path in result.stdout.decode("utf-8").split("\0") if path]


def merge_range(merge: str, cwd: Path | None = None) -> tuple[str, str]:
    """
    The base and head of a pull request's merge commit.

    The diff between the first parent and the merge commit is exactly what the pull request
    changes against the current base. A commit without a second parent is not a merge
    commit; comparing it with its parent would read one commit instead of the pull request,
    so it raises and the caller runs everything.
    """

    def parent(number: int) -> str:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", f"{merge}^{number}"],
            cwd=cwd or REPO_ROOT,
            capture_output=True,
            check=True,
        )
        return result.stdout.decode("utf-8").strip()

    base = parent(1)
    parent(2)
    return base, merge


def tracked_paths(cwd: Path | None = None) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=cwd or REPO_ROOT, capture_output=True, check=True
    )
    return [path for path in result.stdout.decode("utf-8").split("\0") if path]


def _write(decision: dict[str, bool], output: str | None) -> None:
    lines = "".join(
        f"run_{group}={'true' if run else 'false'}\n" for group, run in decision.items()
    )
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(lines)
    sys.stdout.write(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    plan_command = commands.add_parser("plan")
    plan_command.add_argument("--base")
    plan_command.add_argument("--head")
    plan_command.add_argument(
        "--merge",
        help="a pull request's merge commit: compares its first parent (the base) with it",
    )
    plan_command.add_argument(
        "--repository",
        help="the checkout to diff in; defaults to the repository this file lies in",
    )
    plan_command.add_argument("--output")
    commands.add_parser("check")
    args = parser.parse_args(argv)

    try:
        config = load_config()
    except PathFilterError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.command == "check":
        errors = coverage_errors(config, tracked_paths())
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        if errors:
            return 1
        print("Every tracked file falls in a test group or is listed as untested.")
        return 0

    repository = Path(args.repository) if args.repository else None
    try:
        if args.merge:
            base, head = merge_range(args.merge, cwd=repository)
        elif args.base and args.head:
            base, head = args.base, args.head
        else:
            parser.error("plan needs --merge, or --base and --head")
        paths = changed_paths(base, head, cwd=repository)
    except (OSError, subprocess.CalledProcessError, UnicodeDecodeError) as error:
        print(f"::warning::cannot read the changed paths, running everything: {error}")
        _write(everything(config), args.output)
        return 0
    decision, reasons = plan(config, paths)
    print(f"{len(paths)} changed paths")
    if reasons:
        shown = ", ".join(reasons[:10]) + (" ..." if len(reasons) > 10 else "")
        print(f"::notice::running everything, no rule for: {shown}")
    _write(decision, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
