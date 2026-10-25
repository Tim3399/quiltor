"""The path filter that decides which test.yml job groups a pull request needs."""

from __future__ import annotations

import io
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


if __name__ == "__main__":
    unittest.main()
