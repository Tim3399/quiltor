"""The path filter that decides which test.yml job groups a pull request needs."""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "distribution" / "tooling"))

import path_filter  # noqa: E402

from tests.python.git_bash import find_bash  # noqa: E402

GROUPS = {"checks": "lint", "python": "backend", "browser": "browser suites"}


def config(rules=None, untested=None):
    return path_filter.parse_config(
        {
            "schemaVersion": 1,
            "groups": GROUPS,
            "rules": rules
            if rules is not None
            else [
                {
                    "name": "python",
                    "patterns": ["src/**", "tests/python/**"],
                    "groups": ["checks", "python"],
                    "reason": "The backend and its tests.",
                },
                {
                    "name": "server",
                    "patterns": ["src/server/**"],
                    "groups": ["browser"],
                    "reason": "The server the browser suite talks to.",
                },
                {
                    "name": "docs",
                    "patterns": ["docs/**/*.md", "*.md"],
                    "groups": ["checks"],
                    "reason": "Prose: formatting and spelling only.",
                },
            ],
            "untested": untested
            if untested is not None
            else [{"patterns": ["docs/*.png"], "reason": "Screenshots no gate reads."}],
        }
    )


class GlobTests(unittest.TestCase):
    def test_star_stays_inside_one_segment(self):
        pattern = path_filter.glob_to_regex("*.md")
        self.assertTrue(pattern.fullmatch("README.md"))
        self.assertFalse(pattern.fullmatch("docs/README.md"))

    def test_double_star_matches_any_depth_including_none(self):
        pattern = path_filter.glob_to_regex("docs/**/*.md")
        for path in ("docs/a.md", "docs/x/a.md", "docs/x/y/a.md"):
            self.assertTrue(pattern.fullmatch(path), path)
        self.assertFalse(pattern.fullmatch("docs/a.png"))
        self.assertFalse(pattern.fullmatch("other/docs/a.md"))

    def test_trailing_double_star_matches_everything_below(self):
        pattern = path_filter.glob_to_regex("src/**")
        self.assertTrue(pattern.fullmatch("src/a/b/c.py"))
        self.assertFalse(pattern.fullmatch("srcx/a.py"))

    def test_dots_are_literal(self):
        self.assertFalse(path_filter.glob_to_regex("a.md").fullmatch("aXmd"))

    def test_unsupported_syntax_is_refused(self):
        for pattern in ("src/[ab].py", "{a,b}.md", "/abs", "a\\b", "src/**x", "x**/y", ""):
            with self.subTest(pattern=pattern), self.assertRaises(path_filter.PathFilterError):
                path_filter.glob_to_regex(pattern)

    def test_a_glob_is_compiled_once_and_a_refused_glob_is_not_cached(self):
        path_filter.glob_to_regex.cache_clear()
        first = path_filter.glob_to_regex("cache-probe/**/*.md")
        hits = path_filter.glob_to_regex.cache_info().hits
        self.assertIs(path_filter.glob_to_regex("cache-probe/**/*.md"), first)
        self.assertEqual(path_filter.glob_to_regex.cache_info().hits, hits + 1)
        for _ in range(2):
            with self.assertRaises(path_filter.PathFilterError):
                path_filter.glob_to_regex("/abs")
        self.assertEqual(path_filter.glob_to_regex.cache_info().currsize, 1)


class PlanTests(unittest.TestCase):
    def test_a_rule_selects_its_groups_only(self):
        decision, reasons = path_filter.plan(config(), ["tests/python/test_x.py"])
        self.assertEqual(decision, {"checks": True, "python": True, "browser": False})
        self.assertEqual(reasons, [])

    def test_a_path_takes_the_union_of_every_rule_it_matches(self):
        decision, _ = path_filter.plan(config(), ["src/server/app.py"])
        self.assertEqual(decision, {"checks": True, "python": True, "browser": True})

    def test_documentation_runs_the_checks_only(self):
        decision, _ = path_filter.plan(config(), ["docs/guide/a.md", "README.md"])
        self.assertEqual(decision, {"checks": True, "python": False, "browser": False})

    def test_an_untested_path_selects_nothing(self):
        decision, reasons = path_filter.plan(config(), ["docs/shot.png"])
        self.assertEqual(decision, {"checks": False, "python": False, "browser": False})
        self.assertEqual(reasons, [])

    def test_an_unknown_path_runs_everything(self):
        decision, reasons = path_filter.plan(config(), ["docs/a.md", "newdir/thing.txt"])
        self.assertEqual(decision, {"checks": True, "python": True, "browser": True})
        self.assertEqual(reasons, ["newdir/thing.txt"])

    def test_an_empty_change_list_runs_everything(self):
        for paths in ([], [""]):
            with self.subTest(paths=paths):
                decision, reasons = path_filter.plan(config(), paths)
                self.assertTrue(all(decision.values()))
                self.assertEqual(reasons, ["<no changed paths>"])


class ConfigTests(unittest.TestCase):
    def rule(self, **changes):
        rule = {
            "name": "python",
            "patterns": ["src/**"],
            "groups": ["python"],
            "reason": "The backend and its tests.",
        }
        rule.update(changes)
        return {key: value for key, value in rule.items() if value is not None}

    def test_every_entry_needs_a_reason(self):
        for reason in (None, "", "   ", "short"):
            with (
                self.subTest(reason=reason),
                self.assertRaisesRegex(path_filter.PathFilterError, "needs a reason"),
            ):
                config(rules=[self.rule(reason=reason)])
            with (
                self.subTest(untested=reason),
                self.assertRaisesRegex(path_filter.PathFilterError, "needs a reason"),
            ):
                config(untested=[{"patterns": ["x"], "reason": reason}])

    def test_a_rule_without_groups_is_refused(self):
        for groups in (None, []):
            with (
                self.subTest(groups=groups),
                self.assertRaisesRegex(path_filter.PathFilterError, "selects no group"),
            ):
                config(rules=[self.rule(groups=groups)])

    def test_unknown_groups_and_grouped_untested_entries_are_refused(self):
        with self.assertRaisesRegex(path_filter.PathFilterError, "unknown groups: docker"):
            config(rules=[self.rule(groups=["docker"])])
        with self.assertRaisesRegex(path_filter.PathFilterError, "belongs in the rules"):
            config(untested=[{"patterns": ["x"], "groups": [], "reason": "Not tested at all."}])

    def test_patterns_are_required_and_validated(self):
        for patterns in (None, [], [3], ["src/[ab]"]):
            with self.subTest(patterns=patterns), self.assertRaises(path_filter.PathFilterError):
                config(rules=[self.rule(patterns=patterns)])

    def test_the_schema_is_versioned(self):
        with self.assertRaisesRegex(path_filter.PathFilterError, "schema"):
            path_filter.parse_config({"schemaVersion": 2})

    def test_the_repository_configuration_parses(self):
        loaded = path_filter.load_config()
        self.assertIn("browser", loaded.groups)


class CoverageTests(unittest.TestCase):
    def test_complete_coverage_has_no_errors(self):
        tracked = ["src/a.py", "src/server/b.py", "tests/python/t.py", "docs/a.md", "docs/s.png"]
        tracked.append("README.md")
        self.assertEqual(path_filter.coverage_errors(config(), tracked), [])

    def test_a_file_in_no_group_is_named(self):
        errors = path_filter.coverage_errors(
            config(), ["src/a.py", "src/server/b.py", "docs/a.md", "docs/s.png", "Makefile"]
        )
        self.assertIn("Makefile falls in no group and is not listed as untested", errors)

    def test_a_file_both_tested_and_untested_is_named(self):
        untested = [{"patterns": ["docs/**"], "reason": "Everything under docs is prose."}]
        errors = path_filter.coverage_errors(
            config(untested=untested), ["src/a.py", "src/server/b.py", "docs/a.md"]
        )
        self.assertIn("docs/a.md is both tested and listed as untested", errors)

    def test_an_entry_that_matches_nothing_is_named(self):
        errors = path_filter.coverage_errors(config(), ["src/a.py", "docs/a.md", "docs/s.png"])
        self.assertIn("server matches no tracked file", errors)

    def test_the_repository_is_covered(self):
        tracked = path_filter.tracked_paths()
        self.assertGreater(len(tracked), 100)
        self.assertEqual(path_filter.coverage_errors(path_filter.load_config(), tracked), [])


class GitTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI")
        self.commit("base.txt", "base")

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, capture_output=True, text=True, check=True
        ).stdout.strip()

    def commit(self, name, text):
        (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", name)

    def test_a_merge_commit_compares_its_base_with_the_pull_request(self):
        self.git("switch", "-q", "-c", "topic")
        self.commit("docs/a.md", "a")
        self.commit("src/b.py", "b")
        self.git("switch", "-q", "main")
        self.commit("main-only.txt", "m")
        self.git("merge", "-q", "--no-ff", "-m", "merge", "topic")
        base, head = path_filter.merge_range("HEAD", cwd=self.repo)
        self.assertEqual(base, self.git("rev-parse", "HEAD^1"))
        self.assertEqual(
            sorted(path_filter.changed_paths(base, head, cwd=self.repo)), ["docs/a.md", "src/b.py"]
        )

    def test_a_rename_counts_as_both_paths(self):
        self.commit("src/old.py", "x")
        (self.repo / "docs").mkdir()
        self.git("mv", "src/old.py", "docs/new.md")
        self.git("commit", "-q", "-m", "rename")
        self.assertEqual(
            sorted(path_filter.changed_paths("HEAD^", "HEAD", cwd=self.repo)),
            ["docs/new.md", "src/old.py"],
        )

    def test_a_commit_without_a_second_parent_is_not_a_merge(self):
        # Two plain commits: HEAD^1 exists, so only the missing HEAD^2 can refuse this.
        self.commit("docs/a.md", "a")
        with self.assertRaises(subprocess.CalledProcessError):
            path_filter.merge_range("HEAD", cwd=self.repo)

    def run_plan(self, *args):
        output = self.repo / "github-output"
        output.unlink(missing_ok=True)
        stdout = io.StringIO()
        with (
            mock.patch.object(path_filter, "REPO_ROOT", self.repo),
            mock.patch.object(path_filter, "load_config", return_value=config()),
            redirect_stdout(stdout),
            redirect_stderr(io.StringIO()),
        ):
            status = path_filter.main(["plan", *args, "--output", str(output)])
        return status, output.read_text(encoding="utf-8"), stdout.getvalue()

    def test_the_cli_writes_one_output_per_group(self):
        self.commit("docs/a.md", "a")
        status, written, _ = self.run_plan("--base", "HEAD^", "--head", "HEAD")
        self.assertEqual(status, 0)
        self.assertEqual(written, "run_checks=true\nrun_python=false\nrun_browser=false\n")

    def test_the_cli_runs_everything_when_the_diff_cannot_be_read(self):
        status, written, printed = self.run_plan("--merge", "HEAD")
        self.assertEqual(status, 0)
        self.assertEqual(written, "run_checks=true\nrun_python=true\nrun_browser=true\n")
        self.assertIn("::warning::cannot read the changed paths, running everything", printed)
        status, written, _ = self.run_plan("--base", "no-such-rev", "--head", "HEAD")
        self.assertEqual(written, "run_checks=true\nrun_python=true\nrun_browser=true\n")

    def test_the_cli_runs_everything_on_an_unknown_path(self):
        self.commit("newdir/x.txt", "x")
        _, written, printed = self.run_plan("--base", "HEAD^", "--head", "HEAD")
        self.assertEqual(written, "run_checks=true\nrun_python=true\nrun_browser=true\n")
        self.assertIn("::notice::running everything, no rule for: newdir/x.txt", printed)

    def test_check_fails_on_an_uncovered_file(self):
        self.commit("src/a.py", "a")
        stderr = io.StringIO()
        with (
            mock.patch.object(path_filter, "REPO_ROOT", self.repo),
            mock.patch.object(path_filter, "load_config", return_value=config()),
            redirect_stdout(io.StringIO()),
            redirect_stderr(stderr),
        ):
            status = path_filter.main(["check"])
        self.assertEqual(status, 1)
        self.assertIn("base.txt falls in no group", stderr.getvalue())


_bash = find_bash


def _filter_step_script():
    """The run: block of the plan job's filter step, exactly as test.yml has it."""

    workflow = (REPO_ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8")
    step = re.search(
        r"^      - id: filter\n(?:        (?!run:).*\n)*        run: \|\n((?:          .*\n)+)",
        workflow,
        re.MULTILINE,
    )
    assert step is not None, "test.yml has no multi-line filter step"
    return "".join(line[10:] + "\n" for line in step.group(1).splitlines())


@unittest.skipUnless(_bash(), "needs bash to run the workflow step")
class BaseFilterTests(unittest.TestCase):
    """F-37-3: the plan job judges a pull request by the base's filter, not by its own."""

    SERVER_FILE = "src/quiltor/delivery/http/routes/history.py"

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI")
        self.git("config", "core.autocrlf", "false")

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, capture_output=True, text=True, check=True
        ).stdout.strip()

    def write(self, name, text):
        (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / name).write_text(text, encoding="utf-8")

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def install_filter(self, config_text=None):
        self.write(
            ".github/test-paths.json",
            config_text or (REPO_ROOT / ".github/test-paths.json").read_text(encoding="utf-8"),
        )
        self.write(
            "distribution/tooling/path_filter.py",
            (REPO_ROOT / "distribution/tooling/path_filter.py").read_text(encoding="utf-8"),
        )

    def without_browser(self):
        """The review's probe: the server and filter rules no longer select browser."""
        document = json.loads((REPO_ROOT / ".github/test-paths.json").read_text(encoding="utf-8"))
        for rule in document["rules"]:
            if rule["name"] in ("server", "filter"):
                rule["groups"] = [group for group in rule["groups"] if group != "browser"]
        return json.dumps(document, indent=2) + "\n"

    def pull_request(self, base_has_filter, change):
        """A base commit, a pull request commit on a branch, and GitHub's merge commit."""
        self.write("VERSION", "1.0.0\n")
        self.write(self.SERVER_FILE, "# history\n")
        self.write("docs/plans/a.md", "# a\n")
        if base_has_filter:
            self.install_filter()
        self.commit("base")
        self.git("switch", "-q", "-c", "topic")
        change()
        self.commit("pull request")
        self.git("switch", "-q", "main")
        self.write("docs/plans/main.md", "# main\n")
        self.commit("main moves on")
        self.git("merge", "-q", "--no-ff", "-m", "merge", "topic")

    def run_step(self):
        temp = Path(self.directory.name) / "runner-temp"
        temp.mkdir(exist_ok=True)
        output = Path(self.directory.name) / "github-output"
        output.write_text("", encoding="utf-8")
        environment = dict(os.environ)
        environment.update(
            RUNNER_TEMP=temp.as_posix(),
            GITHUB_OUTPUT=output.as_posix(),
            PATH=os.pathsep.join([str(Path(sys.executable).parent), environment["PATH"]]),
        )
        bash = _bash()
        assert bash is not None
        result = subprocess.run(
            [bash, "-e", "-c", _filter_step_script()],
            cwd=self.repo,
            env=environment,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        written = dict(
            line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines()
        )
        return written, result.stdout

    def test_a_pull_request_that_drops_browser_from_the_filter_still_runs_it(self):
        def change():
            self.write(".github/test-paths.json", self.without_browser())
            self.write(self.SERVER_FILE, "# history, changed\n")

        self.pull_request(base_has_filter=True, change=change)
        # Before F-37-3: the pull request's own copy, as the plan job used to run it.
        own = subprocess.run(
            [sys.executable, "distribution/tooling/path_filter.py", "plan", "--merge", "HEAD"],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertIn("run_browser=false", own)
        written, _ = self.run_step()
        self.assertEqual(written["run_browser"], "true")
        self.assertEqual(set(written.values()), {"true"})

    def test_the_base_filter_still_reduces_an_ordinary_pull_request(self):
        self.pull_request(True, lambda: self.write("docs/plans/a.md", "# a, changed\n"))
        written, _ = self.run_step()
        self.assertEqual(written["run_checks"], "true")
        self.assertEqual(written["run_browser"], "false")

    def test_a_base_without_the_filter_writes_nothing_and_everything_runs(self):
        self.pull_request(False, self.install_filter)
        written, printed = self.run_step()
        self.assertEqual(written, {})
        self.assertIn(
            "::warning::the base has no readable path filter, running everything", printed
        )


BASES = ["agent-team-einrichtung", "main", "release/*", "int/v*"]
NATIVE = {
    "patterns": [
        "src/quiltor/hosts/desktop/**",
        "Cargo.toml",
        "Cargo.lock",
        "crates/**",
        "rust-toolchain.toml",
        "distribution/**",
    ],
    "exclude": ["distribution/tooling/**", "distribution/assets/**"],
    "reason": "Code that behaves differently on Windows and macOS.",
}


def profile_config(bases=BASES, native=NATIVE):
    document = {
        "schemaVersion": 1,
        "groups": GROUPS,
        "rules": [
            {
                "name": "all",
                "patterns": ["**"],
                "groups": ["checks"],
                "reason": "Every file, for these tests.",
            }
        ],
    }
    if bases is not None:
        document["integration_bases"] = bases
    if native is not None:
        document["native"] = native
    return path_filter.parse_config(document)


class ProfileTests(unittest.TestCase):
    """T-341 part B: which base a manual run is measured from, and when it becomes full."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name)
        self.git("init", "-q", "-b", "agent-team-einrichtung")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI")
        self.commit("VERSION", "3.26.0\n")
        self.commit("Cargo.toml", '[package]\nname = "quiltor"\nversion = "3.26.0"\n')
        self.publish("agent-team-einrichtung")

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, capture_output=True, text=True, check=True
        ).stdout.strip()

    def commit(self, name, text):
        (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", name)
        return self.git("rev-parse", "HEAD")

    def publish(self, branch, commit="HEAD"):
        """The branch as the plan job's checkout sees it: a ref under refs/remotes/origin/."""
        self.git("update-ref", f"refs/remotes/origin/{branch}", self.git("rev-parse", commit))

    def base(self, branch, bases=BASES):
        return path_filter.select_base(bases, "HEAD", branch, cwd=self.repo)

    def found_base(self, branch):
        """The base the test expects to exist, narrowed for the type checker."""
        found = self.base(branch)
        self.assertIsNotNone(found)
        assert found is not None
        return found

    def decide(self, branch, expect_base="", configuration=None):
        if expect_base == "":
            found = self.base(branch)
            expect_base = found.commit if found else None
        return path_filter.decide_profile(
            configuration or profile_config(), "HEAD", branch, expect_base, cwd=self.repo
        )

    def test_the_nearest_fork_point_wins(self):
        self.git("switch", "-q", "-c", "int/v3.27.0")
        line_start = self.commit("docs/line.md", "line")
        self.publish("int/v3.27.0")
        self.git("switch", "-q", "-c", "dev/T-1")
        self.commit("docs/task.md", "task")
        base = self.found_base("dev/T-1")
        self.assertEqual((base.branch, base.commit, base.distance), ("int/v3.27.0", line_start, 1))

    def test_a_task_branching_mid_line_is_measured_from_its_fork_point_not_from_version(self):
        # F-341-8: VERSION still names the previous release while the line is being built.
        self.git("switch", "-q", "-c", "int/v3.27.0")
        self.commit("docs/first.md", "first")
        fork = self.commit("docs/second.md", "second")
        self.git("switch", "-q", "-c", "dev/T-2")
        self.commit("src/quiltor/hosts/desktop/window.py", "task")
        self.git("switch", "-q", "int/v3.27.0")
        self.commit("docs/third.md", "after the task branched")
        self.publish("int/v3.27.0")
        self.git("switch", "-q", "dev/T-2")
        self.assertEqual((self.repo / "VERSION").read_text(encoding="utf-8"), "3.26.0\n")
        base = self.found_base("dev/T-2")
        self.assertEqual((base.branch, base.commit, base.distance), ("int/v3.27.0", fork, 1))

    def test_a_task_line_and_the_own_branch_are_never_candidates(self):
        self.git("switch", "-q", "-c", "int/T-61")
        sibling = self.commit("docs/sibling.md", "sibling")
        self.publish("int/T-61")
        self.git("switch", "-q", "-c", "int/v3.27.0")
        self.commit("docs/own.md", "own")
        self.publish("int/v3.27.0")
        base = self.found_base("int/v3.27.0")
        self.assertEqual(base.branch, "agent-team-einrichtung")
        self.assertNotEqual(base.commit, sibling)
        self.assertEqual(base.distance, 2)

    def test_the_own_line_is_no_base_even_behind_the_head(self):
        # A version line measured against its own older tip would see one commit, not the line.
        self.git("switch", "-q", "-c", "int/v3.27.0")
        self.commit("docs/a.md", "a")
        self.publish("int/v3.27.0")
        self.commit("src/quiltor/hosts/desktop/window.py", "native")
        base = self.found_base("int/v3.27.0")
        self.assertEqual((base.branch, base.distance), ("agent-team-einrichtung", 2))

    def test_a_candidate_that_contains_the_head_is_skipped(self):
        self.git("switch", "-q", "-c", "dev/T-3")
        self.commit("docs/x.md", "x")
        self.publish("agent-team-einrichtung")  # already merged: its fork point is the head
        self.publish("release/3.26.x", "HEAD~1")
        base = self.found_base("dev/T-3")
        self.assertEqual((base.branch, base.distance), ("release/3.26.x", 1))

    def test_no_candidate_is_no_base_and_a_full_run(self):
        self.git("switch", "-q", "-c", "dev/T-4")
        self.commit("docs/x.md", "x")
        self.git("update-ref", "-d", "refs/remotes/origin/agent-team-einrichtung")
        self.assertIsNone(self.base("dev/T-4"))
        full, notes = self.decide("dev/T-4")
        self.assertTrue(full)
        self.assertIn("::warning::no integration base found, raised to full", notes)

    def test_a_native_change_raises_and_anything_else_does_not(self):
        cases = (
            ("src/quiltor/hosts/desktop/window.py", True),
            ("crates/core/src/lib.rs", True),
            ("rust-toolchain.toml", True),
            ("distribution/toolchains.json", True),
            ("distribution/desktop/macos/build.sh", True),
            ("distribution/tooling/release_preflight.py", False),
            ("distribution/assets/icon.png", False),
            (".github/workflows/test.yml", False),
            ("tools/dev/playwright-linux.sh", False),
            ("src/quiltor/hosts/web/server.py", False),
        )
        for index, (path, expected) in enumerate(cases):
            with self.subTest(path=path):
                self.git("switch", "-q", "-c", f"dev/T-{index}", "agent-team-einrichtung")
                self.commit(path, f"change {index}")
                full, notes = self.decide(f"dev/T-{index}")
                self.assertIs(full, expected, notes)

    def test_a_pure_version_bump_is_not_native(self):
        self.git("switch", "-q", "-c", "dev/T-5")
        self.commit("Cargo.toml", '[package]\nname = "quiltor"\nversion = "3.27.0"\n')
        self.commit("VERSION", "3.27.0\n")
        self.assertEqual(self.decide("dev/T-5")[0], False)

    def test_a_new_dependency_beside_the_version_is_native(self):
        self.git("switch", "-q", "-c", "dev/T-6")
        self.commit(
            "Cargo.toml",
            '[package]\nname = "quiltor"\nversion = "3.27.0"\n\n[dependencies]\nserde = "1"\n',
        )
        full, notes = self.decide("dev/T-6")
        self.assertTrue(full)
        self.assertIn("::notice::profile raised to full by native paths: Cargo.toml", notes)

    def test_a_base_without_the_rules_raises_to_full(self):
        self.git("switch", "-q", "-c", "dev/T-7")
        self.commit("docs/x.md", "x")
        for configuration in (profile_config(bases=None), profile_config(native=None)):
            full, notes = self.decide("dev/T-7", configuration=configuration)
            self.assertTrue(full)
            self.assertIn("::warning::the base has no profile rules, raised to full", notes)

    def test_a_base_the_heads_rules_did_not_choose_raises_to_full(self):
        self.git("switch", "-q", "-c", "dev/T-8")
        self.commit("docs/x.md", "x")
        full, notes = self.decide("dev/T-8", expect_base="0" * 40)
        self.assertTrue(full)
        self.assertTrue(any("raised to full" in note and "chose" in note for note in notes))

    def test_a_native_change_from_merged_branches_is_named(self):
        self.git("switch", "-q", "-c", "other")
        self.commit("distribution/desktop/x.cfg", "native, from elsewhere")
        self.git("switch", "-q", "-c", "int/T-9", "agent-team-einrichtung")
        self.commit("docs/own.md", "own")
        self.git("merge", "-q", "--no-ff", "-m", "merge other", "other")
        full, notes = self.decide("int/T-9")
        self.assertTrue(full)
        self.assertTrue(
            any(note.startswith("::warning::int/T-9 is an int branch") for note in notes)
        )
        self.assertTrue(
            any("may come from merged branches: 3 commits" in note for note in notes), notes
        )

    def test_a_version_line_is_not_warned_about(self):
        self.git("switch", "-q", "-c", "int/v3.27.0")
        self.commit("docs/x.md", "x")
        _, notes = self.decide("int/v3.27.0")
        self.assertFalse(any("int branch outside" in note for note in notes))

    def run_cli(self, *args):
        output = self.repo / "github-output"
        summary = self.repo / "github-summary"
        output.unlink(missing_ok=True)
        summary.unlink(missing_ok=True)
        stdout = io.StringIO()
        with (
            mock.patch.object(path_filter, "load_config", return_value=profile_config()),
            redirect_stdout(stdout),
            redirect_stderr(io.StringIO()),
        ):
            status = path_filter.main(
                [*args, "--repository", str(self.repo)]
                + (
                    ["--output", str(output), "--summary", str(summary)]
                    if args[0] == "profile"
                    else []
                )
            )
        read = lambda path: path.read_text(encoding="utf-8") if path.exists() else ""  # noqa: E731
        return status, read(output), read(summary), stdout.getvalue()

    def test_the_cli_names_the_base_and_writes_the_profile(self):
        self.git("switch", "-q", "-c", "dev/T-10")
        self.commit("docs/x.md", "x")
        status, _, _, printed = self.run_cli("base", "--head", "HEAD", "--branch", "dev/T-10")
        commit = printed.strip()
        self.assertEqual((status, commit), (0, self.git("rev-parse", "HEAD~1")))
        status, written, summary, _ = self.run_cli(
            "profile", "--head", "HEAD", "--branch", "dev/T-10", "--expect-base", commit
        )
        self.assertEqual((status, written), (0, "full_matrix=false\n"))
        self.assertIn("- Base: agent-team-einrichtung at", summary)
        self.assertIn("- Profile: integration, no native change since the base", summary)

    def test_the_cli_without_a_base_fails_and_a_broken_decision_is_full(self):
        self.git("switch", "-q", "-c", "dev/T-11")
        self.commit("docs/x.md", "x")
        self.git("update-ref", "-d", "refs/remotes/origin/agent-team-einrichtung")
        status, _, _, printed = self.run_cli("base", "--head", "HEAD", "--branch", "dev/T-11")
        self.assertEqual((status, printed), (1, ""))
        status, written, _, printed = self.run_cli(
            "profile", "--head", "no-such-rev", "--branch", "dev/T-11", "--expect-base", "x"
        )
        self.assertEqual((status, written), (0, "full_matrix=true\n"))
        self.assertIn("::warning::cannot decide the profile, raised to full", printed)

    def test_the_repository_declares_the_profile_rules(self):
        configuration = path_filter.load_config()
        self.assertEqual(list(configuration.integration_bases), BASES)
        self.assertIsNotNone(configuration.native)
        assert configuration.native is not None
        self.assertEqual(
            (list(configuration.native.patterns), list(configuration.native.exclude)),
            (NATIVE["patterns"], NATIVE["exclude"]),
        )

    def test_profile_rules_are_validated(self):
        for document, error in (
            ({"integration_bases": "main"}, "integration_bases must be a list"),
            ({"integration_bases": ["int/[x]"]}, "only \\*, \\*\\* and \\? are supported"),
            ({"native": []}, "native is not an object"),
            ({"native": {"patterns": ["x"]}}, "native needs a reason"),
            ({"native": {"patterns": [], "reason": "A reason long enough."}}, "native needs a"),
        ):
            with self.subTest(document=document):
                base = {
                    "schemaVersion": 1,
                    "groups": GROUPS,
                    "rules": [
                        {"name": "a", "patterns": ["**"], "groups": ["checks"], "reason": "x" * 12}
                    ],
                }
                with self.assertRaisesRegex(path_filter.PathFilterError, error):
                    path_filter.parse_config({**base, **document})


if __name__ == "__main__":
    unittest.main()
