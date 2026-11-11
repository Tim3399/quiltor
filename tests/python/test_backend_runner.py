"""T-252: the parallel backend runner counts every unit and reports every failure.

Each case builds a small throwaway suite in a temp directory and runs the runner on it in a
subprocess, the way npm and CI start it.
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "tools" / "dev" / "backend-tests.py"

PASSING = """
import unittest

class Passing(unittest.TestCase):
    def test_one(self):
        pass

    def test_two(self):
        pass
"""

HELPER = """
VALUE = 1
"""

# Imports a sibling by its package path, which needs the working directory on sys.path --
# the way 51 real modules import `tests.python.*`.
IMPORTS_A_HELPER = """
import unittest

from tests.helper import VALUE

class Imports(unittest.TestCase):
    def test_one(self):
        self.assertEqual(VALUE, 1)

    def test_two(self):
        pass
"""

FAILING = """
import unittest

class Failing(unittest.TestCase):
    def test_red(self):
        self.assertEqual(1, 2)
"""

SKIPPING = """
import unittest

class Skipping(unittest.TestCase):
    @unittest.skip("not here")
    def test_skipped(self):
        pass

    def test_run(self):
        pass
"""

SKIPS_AT_IMPORT = """
import unittest

raise unittest.SkipTest("needs something this machine lacks")
"""

CRASHES_AT_IMPORT = """
raise RuntimeError("broken module")
"""

CRASHES_THE_PROCESS = """
import os
import unittest

class Crash(unittest.TestCase):
    def test_exit(self):
        os._exit(3)
"""

# Discovered with two tests in the runner's own process, but only one in the child: the
# marker file exists by the time the child imports the module.
LOSES_A_TEST = """
import unittest
from pathlib import Path

MARKER = Path(__file__).with_name("seen.marker")
FIRST = not MARKER.exists()
MARKER.write_text("seen")

class Shrinking(unittest.TestCase):
    def test_always(self):
        pass

    if FIRST:
        def test_only_the_first_time(self):
            pass
"""

SEES_NO_QUILTOR_ENV = """
import os
import unittest

class Environment(unittest.TestCase):
    def test_no_quiltor_variable_arrives(self):
        self.assertEqual([k for k in os.environ if k.upper().startswith("QUILTOR_")], [])
"""

TWO_CLASSES = """
import unittest

class First(unittest.TestCase):
    def test_a(self):
        pass

class Second(unittest.TestCase):
    def test_b(self):
        pass

    def test_c(self):
        pass
"""

WRITES_INTO_DATA = """
import unittest
from pathlib import Path

class Writes(unittest.TestCase):
    def test_writes_next_to_the_repository(self):
        Path("data").mkdir(exist_ok=True)
        Path("data", "leaked.txt").write_text("x")
"""

LEAVES_A_TEMP_FILE = """
import tempfile
import unittest

class Leaves(unittest.TestCase):
    def test_forgets_to_clean_up(self):
        handle, _ = tempfile.mkstemp()
        import os
        os.close(handle)
"""


class BackendRunnerTests(unittest.TestCase):
    def suite(self, **modules: str) -> Path:
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        tests = root / "tests"
        tests.mkdir()
        for name, source in modules.items():
            (tests / f"{name}.py").write_text(textwrap.dedent(source), encoding="utf-8")
        return root

    def run_runner(self, root: Path, *extra: str, env: dict | None = None):
        environment = dict(os.environ)
        environment.update(env or {})
        completed = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--cwd",
                str(root),
                "--start",
                "tests",
                "--home",
                str(root / "home"),
                "--workers",
                "2",
                *extra,
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=environment,
            check=False,
        )
        return completed.returncode, completed.stdout + completed.stderr

    def test_a_green_suite_exits_zero_and_names_the_worker_count(self):
        root = self.suite(test_passing=PASSING, test_skipping=SKIPPING)
        code, output = self.run_runner(root)
        self.assertEqual(code, 0, output)
        self.assertIn("Ran 4 tests in 2 units with 2 workers", output)
        self.assertIn("(skipped=1) -- OK", output)

    def test_a_module_importing_through_the_working_directory_is_counted_in_full(self):
        root = self.suite(test_imports=IMPORTS_A_HELPER, helper=HELPER)
        (root / "tests" / "__init__.py").write_text("", encoding="utf-8")
        code, output = self.run_runner(root)
        self.assertEqual(code, 0, output)
        self.assertIn("Ran 2 tests in 1 units", output)

    def test_a_red_unit_gives_exit_one(self):
        root = self.suite(test_passing=PASSING, test_failing=FAILING)
        code, output = self.run_runner(root)
        self.assertEqual(code, 1, output)
        self.assertIn("FAILED unit test_failing: exit code 1", output)
        self.assertIn("AssertionError: 1 != 2", output)

    def test_a_module_that_skips_itself_at_import_counts_as_one_skip(self):
        root = self.suite(test_passing=PASSING, test_skips_at_import=SKIPS_AT_IMPORT)
        code, output = self.run_runner(root)
        self.assertEqual(code, 0, output)
        self.assertIn("Ran 3 tests in 2 units", output)
        self.assertIn("(skipped=1) -- OK", output)

    def test_a_module_that_cannot_be_imported_fails(self):
        root = self.suite(test_passing=PASSING, test_broken=CRASHES_AT_IMPORT)
        code, output = self.run_runner(root)
        self.assertEqual(code, 1, output)
        self.assertIn("FAILED unit test_broken", output)
        self.assertIn("RuntimeError: broken module", output)

    def test_a_process_that_dies_mid_unit_fails(self):
        root = self.suite(test_passing=PASSING, test_crash=CRASHES_THE_PROCESS)
        code, output = self.run_runner(root)
        self.assertEqual(code, 1, output)
        self.assertIn("FAILED unit test_crash: exit code 3", output)
        self.assertIn("reported no 'Ran N tests' line", output)

    def test_a_unit_that_loses_tests_is_detected(self):
        root = self.suite(test_shrinking=LOSES_A_TEST)
        code, output = self.run_runner(root)
        self.assertEqual(code, 1, output)
        self.assertIn("ran 1 tests, 2 were discovered", output)
        self.assertIn("COUNT MISMATCH: ran 1 tests, 2 were discovered", output)

    def test_quiltor_variables_do_not_reach_the_units(self):
        root = self.suite(test_environment=SEES_NO_QUILTOR_ENV)
        code, output = self.run_runner(root, env={"QUILTOR_HOME": str(root), "quiltor_x": "1"})
        self.assertEqual(code, 0, output)

    def test_serial_passes_the_environment_through_unchanged(self):
        root = self.suite(test_environment=SEES_NO_QUILTOR_ENV)
        code, output = self.run_runner(root, "--serial", env={"QUILTOR_HOME": str(root)})
        self.assertEqual(code, 1, output)

    def test_a_slow_module_is_split_by_class(self):
        root = self.suite(test_classes=TWO_CLASSES)
        (root / "tests" / "durations.json").write_text(
            json.dumps({"units": {"test_classes": 99.0}}), encoding="utf-8"
        )
        code, output = self.run_runner(root)
        self.assertEqual(code, 0, output)
        self.assertIn("--- test_classes.First", output)
        self.assertIn("--- test_classes.Second", output)
        self.assertIn("Ran 3 tests in 2 units", output)

    def test_report_json_writes_seconds_per_unit(self):
        root = self.suite(test_passing=PASSING, test_classes=TWO_CLASSES)
        code, output = self.run_runner(root, "--report", "json")
        self.assertEqual(code, 0, output)
        data = json.loads((root / "tests" / "durations.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(data["units"]), ["test_classes", "test_passing"])

    def test_check_leaks_reports_a_file_written_into_data(self):
        root = self.suite(test_writes=WRITES_INTO_DATA)
        code, output = self.run_runner(root, "--check-leaks")
        self.assertEqual(code, 1, output)
        self.assertIn("LEAK data: new leaked.txt", output)

    def test_check_leaks_ignores_what_was_there_before(self):
        root = self.suite(test_passing=PASSING)
        (root / "data").mkdir()
        (root / "data" / "old.txt").write_text("kept", encoding="utf-8")
        (root / "home").mkdir()
        (root / "home" / "mine.txt").write_text("kept", encoding="utf-8")
        code, output = self.run_runner(root, "--check-leaks")
        self.assertEqual(code, 0, output)

    def test_check_leaks_reports_a_file_left_in_the_temp_directory(self):
        root = self.suite(test_leaves=LEAVES_A_TEMP_FILE)
        code, output = self.run_runner(root, "--check-leaks")
        self.assertEqual(code, 1, output)
        self.assertIn("left 1 entries in its temp directory", output)


if __name__ == "__main__":
    unittest.main()
