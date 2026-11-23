#!/usr/bin/env python3
"""
Decide which job groups of test.yml a pull request needs, from the paths it changes.

    path_filter.py plan --merge <rev> [--repository <dir>] [--output <file>]
    path_filter.py plan --base <rev> --head <rev> [--repository <dir>] [--output <file>]
    path_filter.py check
    path_filter.py base --head <rev> --branch <name> [--repository <dir>]
    path_filter.py profile --head <rev> --branch <name> --expect-base <commit>
                           [--repository <dir>] [--output <file>] [--summary <file>]

`plan` runs in the plan job of test.yml and writes one `run_<group>=true|false` line per
group. It is fail-safe: a path no rule knows, an empty change list, or a diff that cannot be
read makes every group true. Only a successful run over known paths can switch a group off.

`check` validates .github/test-paths.json against `git ls-files`: every tracked file falls in
at least one rule or in a justified untested entry. workflow_contract.py calls the same code.

Standard library only: the plan job runs it before any dependency is installed. It runs the
copy from the pull request's base, next to the base's configuration, and points --repository at
the checkout, so a pull request cannot change the rules it is judged by.

`base` and `profile` decide whether a manual run of the integration profile is raised to full
(T-341 part B). `base` names the nearest fork point from the fixed `integration_bases` list;
`profile`, run from the copy in that base, picks the base again by the base's own rules and
raises to full when the change since then touches the `native` group, when the two picks
disagree, or when no base exists. It writes `full_matrix=...` and never lowers a profile.
"""

from __future__ import annotations

import argparse
import functools
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
class Native:
    patterns: tuple[str, ...]
    exclude: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class Config:
    groups: tuple[str, ...]
    rules: tuple[Rule, ...]
    untested: tuple[Rule, ...]
    # T-341 part B. Empty in a configuration from before it: such a base raises to full.
    integration_bases: tuple[str, ...] = ()
    native: Native | None = None


@dataclass(frozen=True)
class Base:
    """The fork point a run is measured from: the nearest one among the integration bases."""

    branch: str
    commit: str
    distance: int
    first_parent: int


# A file whose changed lines are all version lines is a version bump, not a native change
# (D-236 point 2). Every other changed line, a new dependency say, counts.
VERSION_FILES = ("Cargo.toml", "crates/*/Cargo.toml", "Cargo.lock", "package.json", "VERSION")
VERSION_LINE = re.compile(r'\s*(?:version\s*=\s*"[^"]*"|"version"\s*:\s*"[^"]*",?)\s*')
VERSION_FILE_LINE = re.compile(r"\s*[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*\s*")
# The name of a version line. An int branch named otherwise is no candidate for any base.
VERSION_LINE_BRANCH = re.compile(r"int/v[0-9]+\.[0-9]+\.[0-9]+")
REMOTE = "refs/remotes/origin/"


@functools.cache
def glob_to_regex(pattern: str) -> re.Pattern[str]:
    """
    A repository glob as a regex over a slash-separated path.

    `*` and `?` stay inside one path segment, `**/` matches any number of directories
    (also none), and a trailing `**` matches everything below. There is no other syntax:
    a bracket or a brace is refused rather than read some way the author did not mean.

    Cached: the result is an immutable compiled pattern that depends only on the glob, and
    every validation compiles the same few hundred globs thousands of times. A refused glob
    raises and is therefore not cached.
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
    bases = document.get("integration_bases", [])
    if not isinstance(bases, list) or not all(isinstance(base, str) and base for base in bases):
        raise PathFilterError("integration_bases must be a list of branch patterns")
    for base in bases:
        glob_to_regex(base)
    native = None
    if "native" in document:
        entry = document["native"]
        if not isinstance(entry, dict):
            raise PathFilterError("native is not an object")
        exclude = entry.get("exclude", [])
        if not isinstance(exclude, list):
            raise PathFilterError("native exclude must be a list of patterns")
        for pattern in exclude:
            if not isinstance(pattern, str):
                raise PathFilterError("native has an exclude pattern that is not a string")
            glob_to_regex(pattern)
        native = Native(_patterns(entry, "native"), tuple(exclude), _reason(entry, "native"))
    return Config(tuple(groups), tuple(rules), tuple(untested), tuple(bases), native)


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


def _git(arguments: Sequence[str], cwd: Path | None) -> str:
    result = subprocess.run(
        ["git", *arguments], cwd=cwd or REPO_ROOT, capture_output=True, check=True
    )
    return result.stdout.decode("utf-8").strip()


def remote_branches(cwd: Path | None = None) -> list[str]:
    """The branches of origin as the checkout knows them, without the origin/ prefix."""

    refs = _git(["for-each-ref", "--format=%(refname)", REMOTE], cwd).splitlines()
    return [ref.removeprefix(REMOTE) for ref in refs if ref and ref != REMOTE + "HEAD"]


def select_base(
    patterns: Sequence[str], head: str, branch: str, cwd: Path | None = None
) -> Base | None:
    """
    The nearest fork point of `head` from a branch matching one of `patterns`.

    The run's own branch never counts, and neither does a candidate that already contains the
    head (its fork point is the head itself). The fewest commits between fork point and head
    win; a tie goes to the branch name that sorts first. None when no candidate is left.
    """

    tip = _git(["rev-parse", "--verify", f"{head}^{{commit}}"], cwd)
    best: Base | None = None
    for name in sorted(remote_branches(cwd)):
        if name == branch or not any(glob_to_regex(p).fullmatch(name) for p in patterns):
            continue
        try:
            commit = _git(["merge-base", tip, REMOTE + name], cwd)
        except subprocess.CalledProcessError:
            continue  # no common ancestor
        if not commit or commit == tip:
            continue
        distance = int(_git(["rev-list", "--count", f"{commit}..{tip}"], cwd))
        if best is None or distance < best.distance:
            first_parent = int(
                _git(["rev-list", "--first-parent", "--count", f"{commit}..{tip}"], cwd)
            )
            best = Base(name, commit, distance, first_parent)
    return best


def is_native(native: Native, path: str) -> bool:
    return any(glob_to_regex(p).fullmatch(path) for p in native.patterns) and not any(
        glob_to_regex(p).fullmatch(path) for p in native.exclude
    )


def version_only(base: str, head: str, path: str, cwd: Path | None = None) -> bool:
    """True when every line `path` changes between the commits is a version line."""

    if not any(glob_to_regex(pattern).fullmatch(path) for pattern in VERSION_FILES):
        return False
    diff = _git(["diff", "-U0", "--no-renames", base, head, "--", path], cwd)
    changed = [
        line[1:]
        for line in diff.splitlines()
        if line[:1] in "+-" and not line.startswith(("+++", "---"))
    ]
    pattern = VERSION_FILE_LINE if path == "VERSION" else VERSION_LINE
    return bool(changed) and all(pattern.fullmatch(text) for text in changed)


def native_changes(config: Config, base: str, head: str, cwd: Path | None = None) -> list[str]:
    """The changed paths that raise a run to full: native, and more than a version bump."""

    if config.native is None:
        raise PathFilterError("the configuration has no native group")
    native = config.native
    return [
        path
        for path in changed_paths(base, head, cwd=cwd)
        if is_native(native, path) and not version_only(base, head, path, cwd)
    ]


def decide_profile(
    config: Config, head: str, branch: str, expect_base: str | None, cwd: Path | None = None
) -> tuple[bool, list[str]]:
    """
    Whether a run of the integration profile becomes full, and the lines that say why.

    Only ever raises: no base, a base other than `expect_base`, a configuration without the
    rules, or a native change since the base all mean full.
    """

    notes: list[str] = []
    if branch.startswith("int/") and not VERSION_LINE_BRANCH.fullmatch(branch):
        notes.append(
            f"::warning::{branch} is an int branch outside int/v<x.y.z>; no other run takes it "
            "as its base, so a task branched from it is measured from an older fork point"
        )
    if not config.integration_bases or config.native is None:
        notes.append("::warning::the base has no profile rules, raised to full")
        return True, notes
    base = select_base(config.integration_bases, head, branch, cwd)
    if base is None:
        notes.append("::warning::no integration base found, raised to full")
        return True, notes
    notes.append(
        f"Base: {base.branch} at {base.commit[:12]}, {base.distance} commits "
        f"({base.first_parent} first-parent)"
    )
    if expect_base is not None and base.commit != expect_base:
        notes.append(
            f"::warning::the head's rules chose {expect_base[:12]}, the base's rules "
            f"{base.commit[:12]}; raised to full"
        )
        return True, notes
    hits = native_changes(config, base.commit, head, cwd)
    if not hits:
        notes.append("Profile: integration, no native change since the base")
        return False, notes
    shown = ", ".join(hits[:10]) + (" ..." if len(hits) > 10 else "")
    notes.append(f"::notice::profile raised to full by native paths: {shown}")
    if base.distance > base.first_parent:
        notes.append(
            f"::warning::the native change may come from merged branches: {base.distance} "
            f"commits since {base.branch}, {base.first_parent} of them first-parent"
        )
    return True, notes


def _summary_line(note: str) -> str:
    """A workflow command as plain Markdown: `::warning::text` becomes `- text`."""

    text = re.sub(r"^::[a-z]+::", "", note)
    return f"- {text}\n"


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
    for name in ("base", "profile"):
        command = commands.add_parser(name)
        command.add_argument("--head", required=True)
        command.add_argument("--branch", required=True)
        command.add_argument("--repository")
        if name == "profile":
            command.add_argument("--expect-base", required=True)
            command.add_argument("--output")
            command.add_argument("--summary")
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
    if args.command == "base":
        try:
            base = select_base(config.integration_bases, args.head, args.branch, repository)
        except (OSError, subprocess.CalledProcessError, UnicodeDecodeError) as error:
            print(f"error: cannot find the integration base: {error}", file=sys.stderr)
            return 1
        if base is None:
            print("error: no integration base found", file=sys.stderr)
            return 1
        print(base.commit)
        return 0
    if args.command == "profile":
        return _profile(config, args, repository)
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


def _profile(config: Config, args: argparse.Namespace, repository: Path | None) -> int:
    """The profile command: full unless every step of the decision succeeded."""

    try:
        full, notes = decide_profile(config, args.head, args.branch, args.expect_base, repository)
    except (OSError, subprocess.CalledProcessError, UnicodeDecodeError, PathFilterError) as error:
        full, notes = True, [f"::warning::cannot decide the profile, raised to full: {error}"]
    for note in notes:
        print(note)
    line = f"full_matrix={'true' if full else 'false'}\n"
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as handle:
            handle.write("".join(_summary_line(note) for note in notes))
    if args.output:
        with open(args.output, "a", encoding="utf-8") as handle:
            handle.write(line)
    sys.stdout.write(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
