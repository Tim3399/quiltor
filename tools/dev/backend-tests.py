"""Run the backend suite in parallel: one Python process per test module.

The serial reference command stays what it was:

    py -3.12 -m unittest discover -s tests/python -t tests/python

This runner discovers the same tests, groups them into units (a module, or one class of a
module that is too long to be a single unit), and runs each unit in a fresh interpreter with
exactly the load path of the reference command:

    python -m unittest discover -s tests/python -t tests/python -p <file>.py [-k "*.<Class>.*"]

A fresh process per unit is the isolation: environment, loggers, module singletons and
``config.DATA`` live in a process, so two units can never see each other's state. What is left
outside the process -- files, temp directories -- is what ``--check-leaks`` looks at.

Every unit gets its own TMP/TEMP/TMPDIR below a scratch directory, and no ``QUILTOR_*``
variable of the caller reaches it, so a run does not depend on the developer's configuration.

A unit is counted, not trusted: the number of tests each unit reports as run must equal the
number discovered for it. A unit that crashes, loses tests, or reports none is a failure.

Only the standard library is used, on purpose: the suite itself is plain unittest.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import fnmatch
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_START = "tests/python"
DURATIONS = "durations.json"

# A module whose recorded time exceeds this many seconds is split into one unit per class.
DEFAULT_SPLIT_SECONDS = 30.0

RAN = re.compile(r"^Ran (\d+) tests? in ", re.MULTILINE)
SKIPPED = re.compile(r"skipped=(\d+)")
FAILURES = re.compile(r"failures=(\d+)")
ERRORS = re.compile(r"errors=(\d+)")


def default_workers() -> int:
    return max(1, min((os.cpu_count() or 2) // 2, 8))


@dataclass
class Unit:
    """One process worth of tests: a module file, optionally narrowed to one class."""

    file: str  # file name inside the start directory, e.g. "test_storage.py"
    test_class: str | None
    expected: int
    cost: float = 0.0

    @property
    def name(self) -> str:
        stem = self.file[:-3]
        return f"{stem}.{self.test_class}" if self.test_class else stem


@dataclass
class Result:
    unit: Unit
    returncode: int
    seconds: float
    output: str
    ran: int | None = None
    skipped: int = 0
    failures: int = 0
    errors: int = 0
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def _test_ids(suite: unittest.TestSuite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _test_ids(item)
        else:
            yield item


def discover(start: Path, top: Path, pattern: str) -> dict[str, dict[str, int]]:
    """Map each module file to its classes and their test counts.

    Each file is discovered on its own, with the very ``discover -p <file>`` call its unit
    will run, so a TestCase imported from another module is counted where the child counts
    it. A module that raises ``SkipTest`` at import or fails to import shows up as one
    placeholder test (``unittest.loader.ModuleSkipped`` / ``_FailedTest``); it counts as one
    test of that module, which is also what the child reports. Such a module is never split.
    """

    # `python -m unittest` puts the working directory first on sys.path; modules that import
    # `tests.python.*` depend on it, so discovery here must see the same path.
    for entry in (str(REPO_ROOT / "src"), str(top), os.getcwd()):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    modules: dict[str, dict[str, int]] = {}
    files = sorted(
        p.name for p in start.iterdir() if p.is_file() and fnmatch.fnmatch(p.name, pattern)
    )
    for file in files:
        if not file.endswith(".py"):
            continue
        suite = unittest.TestLoader().discover(str(start), pattern=file, top_level_dir=str(top))
        classes: dict[str, int] = {}
        for test in _test_ids(suite):
            name = "" if type(test).__module__.startswith("unittest") else type(test).__name__
            classes[name] = classes.get(name, 0) + 1
        if classes:
            modules[file] = classes
    return modules


def load_durations(start: Path) -> dict[str, float]:
    try:
        data = json.loads((start / DURATIONS).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    units = data.get("units", {}) if isinstance(data, dict) else {}
    return {str(k): float(v) for k, v in units.items() if isinstance(v, (int, float))}


def plan_units(
    modules: dict[str, dict[str, int]], durations: dict[str, float], split_seconds: float
) -> list[Unit]:
    units: list[Unit] = []
    for file, classes in sorted(modules.items()):
        stem = file[:-3]
        total = sum(classes.values())
        whole = durations.get(stem)
        class_times = [durations.get(f"{stem}.{c}") for c in classes]
        known_split = any(t is not None for t in class_times)
        # Split when the module is known to be slow, or was split last time it was timed.
        split = (whole is not None and whole > split_seconds) or (whole is None and known_split)
        if split and "" not in classes and len(classes) > 1:
            for name, count in sorted(classes.items()):
                cost = durations.get(f"{stem}.{name}", float(count))
                units.append(Unit(file, name, count, cost))
        else:
            units.append(Unit(file, None, total, whole if whole is not None else float(total)))
    return units


def child_environment(temp: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("QUILTOR_")}
    source = str(REPO_ROOT / "src")
    env["PYTHONPATH"] = source + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    for key in ("TMP", "TEMP", "TMPDIR"):
        env[key] = str(temp)
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def run_unit(unit: Unit, args: argparse.Namespace, temp_root: Path, index: int) -> Result:
    temp = temp_root / f"u{index:03d}"
    temp.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        args.start,
        "-t",
        args.top,
        "-p",
        unit.file,
    ]
    if unit.test_class:
        command += ["-k", f"*.{unit.test_class}.*"]
    if args.verbose:
        command.append("-v")
    began = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=args.cwd,
        env=child_environment(temp),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    seconds = time.perf_counter() - began
    result = Result(unit, completed.returncode, seconds, completed.stdout)
    tail = completed.stdout[-4000:]
    ran = RAN.findall(completed.stdout)
    if ran:
        result.ran = int(ran[-1])
    verdict = tail.rsplit("\n", 3)
    summary = "\n".join(verdict)
    for pattern, attr in ((SKIPPED, "skipped"), (FAILURES, "failures"), (ERRORS, "errors")):
        found = pattern.findall(summary)
        if found:
            setattr(result, attr, int(found[-1]))
    if completed.returncode != 0:
        result.problems.append(f"exit code {completed.returncode}")
    if result.ran is None:
        result.problems.append("reported no 'Ran N tests' line")
    elif result.ran != unit.expected:
        result.problems.append(f"ran {result.ran} tests, {unit.expected} were discovered")
    if args.check_leaks:
        leftovers = sorted(p.relative_to(temp).as_posix() for p in temp.rglob("*"))
        if leftovers:
            shown = ", ".join(leftovers[:5]) + (" ..." if len(leftovers) > 5 else "")
            result.problems.append(f"left {len(leftovers)} entries in its temp directory: {shown}")
    return result


# --- leak snapshots --------------------------------------------------------------------------


def _tree(root: Path) -> dict[str, float]:
    if not root.exists():
        return {}
    entries: dict[str, float] = {}
    for path in root.rglob("*"):
        try:
            entries[path.relative_to(root).as_posix()] = path.stat().st_mtime
        except OSError:
            continue
    return entries


def _git_status(cwd: Path) -> set[str]:
    try:
        completed = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return set()
    return set(completed.stdout.splitlines()) if completed.returncode == 0 else set()


def snapshot(cwd: Path, home: Path) -> dict[str, object]:
    return {"git": _git_status(cwd), "data": _tree(cwd / "data"), "home": _tree(home)}


def compare(before: dict, after: dict) -> list[str]:
    found: list[str] = []
    for line in sorted(after["git"] - before["git"]):
        found.append(f"repository: {line}")
    for label in ("data", "home"):
        old, new = before[label], after[label]
        for path, mtime in sorted(new.items()):
            if path not in old:
                found.append(f"{label}: new {path}")
            elif old[path] != mtime:
                found.append(f"{label}: changed {path}")
    return found


# --- main ------------------------------------------------------------------------------------


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--workers", type=int, default=default_workers())
    parser.add_argument(
        "--serial", action="store_true", help="run the plain reference command instead"
    )
    parser.add_argument("--pattern", default="test*.py")
    parser.add_argument("--start", default=DEFAULT_START, help=argparse.SUPPRESS)
    parser.add_argument("--top", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--cwd", default=str(REPO_ROOT), help=argparse.SUPPRESS)
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--report", choices=["json"], help="write unit durations to durations.json")
    parser.add_argument("--report-path", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--check-leaks", action="store_true")
    parser.add_argument("--home", default=str(Path.home() / ".quiltor"), help=argparse.SUPPRESS)
    parser.add_argument("--reverse", action="store_true", help="run units in reverse name order")
    parser.add_argument("--shuffle-seed", type=int, default=None)
    parser.add_argument("--split-seconds", type=float, default=DEFAULT_SPLIT_SECONDS)
    args = parser.parse_args(argv)
    if args.top is None:
        args.top = args.start
    args.workers = max(1, args.workers)
    return args


def serial(args: argparse.Namespace) -> int:
    command = [sys.executable, "-m", "unittest", "discover", "-s", args.start, "-t", args.top]
    if args.pattern != "test*.py":
        command += ["-p", args.pattern]
    if args.verbose:
        command.append("-v")
    return subprocess.run(command, cwd=args.cwd, check=False).returncode


def order(units: list[Unit], args: argparse.Namespace) -> list[Unit]:
    if args.shuffle_seed is not None:
        shuffled = sorted(units, key=lambda u: u.name)
        random.Random(args.shuffle_seed).shuffle(shuffled)  # noqa: S311 -- test order, not crypto
        return shuffled
    if args.reverse:
        return sorted(units, key=lambda u: u.name, reverse=True)
    # Longest first, so the pool's tail is short units.
    return sorted(units, key=lambda u: (-u.cost, u.name))


def main(argv: list[str] | None = None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    cwd = Path(args.cwd).resolve()
    start = (cwd / args.start).resolve()
    top = (cwd / args.top).resolve()
    if args.serial:
        return serial(args)

    began = time.perf_counter()
    previous = os.getcwd()
    os.chdir(cwd)
    try:
        modules = discover(start, top, args.pattern)
    finally:
        os.chdir(previous)
    units = order(plan_units(modules, load_durations(start), args.split_seconds), args)
    # Counted from discovery, not from the plan: a unit the plan drops must still be missed.
    expected = sum(sum(classes.values()) for classes in modules.values())

    before = snapshot(cwd, Path(args.home)) if args.check_leaks else None
    temp_root = Path(tempfile.mkdtemp(prefix="quiltor-backend-"))
    lock = threading.Lock()
    results: list[Result] = []

    def report(result: Result) -> None:
        with lock:
            status = "ok" if result.ok else "FAILED"
            print(f"--- {result.unit.name} ({result.seconds:.1f} s, {status})", flush=True)
            if args.verbose or not result.ok:
                print(result.output.rstrip(), flush=True)
                for problem in result.problems:
                    print(f"  runner: {problem}", flush=True)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [
                pool.submit(run_unit, unit, args, temp_root, index)
                for index, unit in enumerate(units)
            ]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                results.append(result)
                report(result)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)

    leaks = compare(before, snapshot(cwd, Path(args.home))) if before is not None else []
    wall = time.perf_counter() - began
    ran = sum(r.ran or 0 for r in results)
    skipped = sum(r.skipped for r in results)
    failed = sorted((r for r in results if not r.ok), key=lambda r: r.unit.name)

    if args.report == "json":
        path = Path(args.report_path) if args.report_path else start / DURATIONS
        payload = {
            "comment": "Seconds per unit, written by tools/dev/backend-tests.py --report json.",
            "units": {
                r.unit.name: round(r.seconds, 2) for r in sorted(results, key=lambda r: r.unit.name)
            },
        }
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print()
    for result in failed:
        print(f"FAILED unit {result.unit.name}: {'; '.join(result.problems)}")
    for leak in leaks:
        print(f"LEAK {leak}")
    if ran != expected:
        print(f"COUNT MISMATCH: ran {ran} tests, {expected} were discovered")
    verdict = "OK" if not failed and not leaks and ran == expected else "FAILED"
    print(
        f"Ran {ran} tests in {len(units)} units with {args.workers} workers "
        f"in {wall:.1f} s (skipped={skipped}) -- {verdict}"
    )
    return 0 if verdict == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
