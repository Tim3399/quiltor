"""Raising the version, and the workflow that turns that into a release.

Two halves of one thing. `packaging/set_version.py` is ordinary code and is
tested as such. `.github/workflows/release.yml` cannot be executed here at all,
so it is read as text -- the same trick tests/backend/test_packaging.py already
uses on the PyInstaller .spec, and for the same reason: a file that only ever
runs somewhere else still has claims in it that can be checked anywhere.

The claims worth pinning are the silent failures. A release that skips a job,
or ships an app whose CFBundleVersion never moves, does not turn anything red.
"""
import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packaging"))

import set_version  # noqa: E402

RELEASE_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "release.yml"


class VersionArithmeticTests(unittest.TestCase):
    def test_each_bump_word_moves_the_right_field(self):
        self.assertEqual(set_version.next_version("2.14.1", "major"), "3.0.0")
        self.assertEqual(set_version.next_version("2.14.1", "minor"), "2.15.0")
        self.assertEqual(set_version.next_version("2.14.1", "patch"), "2.14.2")

    def test_a_bump_resets_the_fields_below_it(self):
        """2.14.1 -> minor is 2.15.0, not 2.15.1."""
        self.assertEqual(set_version.next_version("2.14.1", "minor"), "2.15.0")
        self.assertEqual(set_version.next_version("2.14.1", "major"), "3.0.0")

    def test_an_explicit_version_is_taken_as_given(self):
        self.assertEqual(set_version.next_version("2.14.1", "3.1.4"), "3.1.4")

    def test_versions_compare_as_numbers_not_as_strings(self):
        """"2.9.0" > "2.10.0" as text, which would let a bump go backwards past
        the ahead-of-current check that exists to stop exactly that."""
        self.assertLess(set_version.parse_version("2.9.0"), set_version.parse_version("2.10.0"))

    def test_something_that_is_not_a_version_is_refused(self):
        for invalid in ("v2.15.0", "2.15", "2.15.0-rc1", "latest", "2.15.0.1", ""):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    set_version.next_version("2.14.1", invalid)


class GitRepoTestCase(unittest.TestCase):
    """A throwaway repo holding copies of the three real files.

    Copies, not fixtures: the point is that the script works on the actual
    package-lock.json this repo has, including its formatting.
    """

    @classmethod
    def setUpClass(cls):
        if shutil.which("git") is None:
            raise unittest.SkipTest("git is not available")

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, True)
        for name in (set_version.VERSION_FILE, set_version.PACKAGE_JSON, set_version.PACKAGE_LOCK):
            shutil.copy(REPO_ROOT / name, self.repo / name)
        self._git("init", "-q", ".")
        self._git("add", "-A")
        # Identity and signing forced off: whatever the developer running this
        # has in ~/.gitconfig must not decide whether the suite passes.
        self._git("-c", "user.email=t@example.com", "-c", "user.name=t",
                  "-c", "commit.gpgsign=false", "commit", "-qm", "initial")

    def _git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True).stdout

    def _run(self, *argv):
        """set_version.main() against the throwaway repo.

        Its output is swallowed: this suite prints its own results, and the
        refusal messages are several lines each.
        """
        with patch.object(set_version, "REPO_ROOT", self.repo):
            with contextlib.redirect_stdout(io.StringIO()) as out:
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    status = set_version.main(list(argv))
        self.output = out.getvalue() + err.getvalue()
        return status

    def _versions(self):
        lock = json.loads((self.repo / set_version.PACKAGE_LOCK).read_text(encoding="utf-8"))
        return {
            "VERSION": (self.repo / set_version.VERSION_FILE).read_text(encoding="utf-8").strip(),
            "package.json": json.loads(
                (self.repo / set_version.PACKAGE_JSON).read_text(encoding="utf-8"))["version"],
            "lock.root": lock["version"],
            "lock.packages": lock["packages"][""]["version"],
        }


class ApplyVersionTests(GitRepoTestCase):
    """Derived from whatever VERSION currently holds, never a literal: these
    assert a diff is exactly N lines, which a target that happened to equal the
    current version would silently turn into zero."""

    def setUp(self):
        super().setUp()
        self.target = set_version.next_version(set_version.current_version(self.repo), "major")

    def test_all_four_copies_of_the_number_move_together(self):
        """Four, not three: package-lock.json carries the version twice, and
        updating only its root is worse than updating neither -- `npm ci` then
        fails on a mismatch with package.json rather than on anything obvious."""
        set_version.apply_version(self.target, self.repo)
        self.assertEqual(set(self._versions().values()), {self.target})

    def test_the_lockfile_diff_is_the_two_lines_that_changed(self):
        """A reformatted 3000-line lockfile in a version-bump commit is
        unreviewable, and npm would rewrite it back on the next install."""
        set_version.apply_version(self.target, self.repo)
        diff = self._git("diff", "--numstat", "--", set_version.PACKAGE_LOCK).split()
        self.assertEqual((diff[0], diff[1]), ("2", "2"))

    def test_package_json_keeps_its_formatting_too(self):
        set_version.apply_version(self.target, self.repo)
        diff = self._git("diff", "--numstat", "--", set_version.PACKAGE_JSON).split()
        self.assertEqual((diff[0], diff[1]), ("1", "1"))

    def test_the_version_file_ends_with_a_newline(self):
        """Everything reading it strips whitespace, but a file without a
        trailing newline makes every later diff show two changed lines."""
        set_version.apply_version(self.target, self.repo)
        self.assertEqual((self.repo / set_version.VERSION_FILE).read_text(encoding="utf-8"),
                         self.target + "\n")


class RefusalTests(GitRepoTestCase):
    def test_a_dirty_tree_stops_the_bump(self):
        (self.repo / "README.md").write_text("uncommitted\n", encoding="utf-8")
        self.assertEqual(self._run("minor"), 1)
        self.assertEqual(self._versions()["VERSION"], set_version.current_version(REPO_ROOT))

    def test_the_same_version_again_stops_the_bump(self):
        """release.yml treats an existing tag as "nothing to do" and skips every
        downstream job, so this failure would otherwise be a green empty run."""
        current = set_version.current_version(self.repo)
        self.assertEqual(self._run(current), 1)

    def test_going_backwards_stops_the_bump(self):
        """0.0.0 sorts below anything that has ever been released, whatever
        VERSION happens to say today."""
        self.assertEqual(self._run("0.0.0"), 1)

    def test_a_malformed_version_stops_the_bump(self):
        self.assertEqual(self._run("v3.0.0"), 2)

    def test_nothing_is_written_when_the_bump_is_refused(self):
        before = self._versions()
        for argv in (("0.0.0",), ("v3.0.0",)):
            with self.subTest(argv=argv):
                self.assertNotEqual(self._run(*argv), 0)
                self.assertEqual(self._versions(), before)

    def test_a_clean_tree_and_a_higher_version_succeeds(self):
        self.assertEqual(self._run("minor"), 0)
        expected = set_version.next_version(set_version.current_version(REPO_ROOT), "minor")
        self.assertEqual(set(self._versions().values()), {expected})


class RealFilesTests(unittest.TestCase):
    def test_the_three_files_agree_right_now(self):
        """The same check release.yml's version-check job runs, plus the
        lockfile -- worth failing a pull request over rather than a release."""
        version = set_version.current_version(REPO_ROOT)
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((REPO_ROOT / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)
        self.assertEqual(lock["version"], version)
        self.assertEqual(lock["packages"][""]["version"], version)

    def test_npms_formatting_is_still_the_one_set_version_writes_back(self):
        """set_version.py rewrites these files through json.dumps rather than
        patching lines, which is only safe while that reproduces npm's own
        output byte for byte. If npm ever changes it, this says so -- instead
        of a version bump arriving as a whole-file reformat."""
        for name in ("package.json", "package-lock.json"):
            with self.subTest(file=name):
                raw = (REPO_ROOT / name).read_text(encoding="utf-8")
                rewritten = json.dumps(json.loads(raw), indent=2, ensure_ascii=False) + "\n"
                self.assertEqual(raw, rewritten)


class ReleaseWorkflowTests(unittest.TestCase):
    """release.yml, read as text.

    No YAML parser: tests/backend runs with nothing installed (see test.yml's
    comment on why that is deliberate), so this is substring matching. It is
    enough for the questions being asked, which are all "does the file still
    say X".
    """

    def setUp(self):
        self.workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

    def test_ci_supplies_the_build_number_bundle_py_documents(self):
        """packaging/bundle.py's build_number() says "CI passes its run number
        via QUILTOR_BUILD_NUMBER" and falls back to "0". For a while nothing
        set it, so every build claimed CFBundleVersion 0 -- which Apple accepts
        exactly once, then rejects for not increasing."""
        self.assertIn("QUILTOR_BUILD_NUMBER: ${{ github.run_number }}", self.workflow)

    def test_both_desktop_installers_are_built(self):
        self.assertIn("packaging/build_macos.sh", self.workflow)
        self.assertIn("packaging/build_windows.ps1", self.workflow)

    def test_the_desktop_jobs_wait_for_the_release_to_exist(self):
        """They upload into the release tag-and-release creates. Starting
        before it exists is a race that fails only sometimes."""
        for job in ("macos-app", "windows-app"):
            with self.subTest(job=job):
                self.assertIn(f"\n  {job}:\n", self.workflow)
                after = self.workflow.split(f"\n  {job}:\n", 1)[1]
                self.assertIn("needs: [version-check, tag-and-release]",
                              after[:after.index("steps:")])

    def test_signing_is_configuration_rather_than_a_second_code_path(self):
        """The build script decides from QUILTOR_SIGN_IDENTITY /
        QUILTOR_NOTARY_PROFILE, so the workflow only supplies them. Adding the
        secrets must not require editing this file."""
        self.assertIn("secrets.APPLE_CERTIFICATE_P12", self.workflow)
        self.assertIn("QUILTOR_SIGN_IDENTITY=$IDENTITY", self.workflow)
        self.assertIn("QUILTOR_NOTARY_PROFILE=quiltor-notary", self.workflow)
        # One invocation of each build script, not a signed and an unsigned one.
        self.assertEqual(self.workflow.count("./packaging/build_macos.sh"), 1)

    def test_the_notary_keychain_is_passed_through_to_the_build_script(self):
        """notarytool reads the login keychain unless told otherwise, and the
        profile is stored in a throwaway one under RUNNER_TEMP."""
        self.assertIn("QUILTOR_NOTARY_KEYCHAIN=$KEYCHAIN", self.workflow)
        script = (REPO_ROOT / "packaging" / "build_macos.sh").read_text(encoding="utf-8")
        self.assertIn("QUILTOR_NOTARY_KEYCHAIN", script)
        self.assertIn('--keychain "$NOTARY_KEYCHAIN"', script)

    def test_a_missing_artifact_fails_the_job_rather_than_the_upload(self):
        """build_windows.ps1 skips the installer step when Inno Setup is
        absent and still exits 0. Without an explicit check the release would
        just quietly not have a Windows installer in it."""
        self.assertIn('test -f "$SETUP"', self.workflow)
        self.assertIn('test -f "$DMG"', self.workflow)


if __name__ == "__main__":
    unittest.main()
