"""The log level and the log file come from the environment, and the desktop app in
window mode -- no console to read stderr from -- gets a file by default.

Nothing here sets either variable for the other suites: every test patches the
environment itself and puts the process-wide `quiltor` logger back afterwards.
"""

import contextlib
import io
import json
import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from quiltor.bootstrap.application import build_observability, logging_config_from_env
from quiltor.hosts.desktop import app as desktop_app
from quiltor.infrastructure.observability import StdlibStructuredLogger
from quiltor.infrastructure.observability import stdlib as log_stdlib

OWNED = log_stdlib._OWNED_HANDLER


class _Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        for name in ("QUILTOR_LOG_LEVEL", "QUILTOR_LOG_FILE"):
            os.environ.pop(name, None)
        self.addCleanup(self._restore_logger)

    @staticmethod
    def _restore_logger():
        StdlibStructuredLogger(stream=io.StringIO())  # closes file handlers of the test

    def build(self):
        """build_observability with stderr captured; returns (observability, stderr text)."""
        captured = io.StringIO()
        with patch.object(sys, "stderr", captured):
            observability = build_observability()
        return observability, captured


class ConfigFromEnvironmentTests(unittest.TestCase):
    def test_without_variables_it_is_info_and_no_file(self):
        config = logging_config_from_env({})
        self.assertEqual((config.level, config.file), ("INFO", None))

    def test_the_level_is_case_insensitive(self):
        for raw in ("debug", "Warning", "ERROR", " info "):
            with self.subTest(raw):
                self.assertEqual(
                    logging_config_from_env({"QUILTOR_LOG_LEVEL": raw}).level, raw.strip().upper()
                )

    def test_a_blank_file_means_no_file(self):
        self.assertIsNone(logging_config_from_env({"QUILTOR_LOG_FILE": "  "}).file)

    def test_an_unknown_level_is_rejected_and_named(self):
        for raw in ("verbose", "10", "CRITICAL"):
            with self.subTest(raw), self.assertRaisesRegex(ValueError, "QUILTOR_LOG_LEVEL"):
                logging_config_from_env({"QUILTOR_LOG_LEVEL": raw})


class LevelTests(_Isolated):
    def test_debug_enables_debug_lines_and_info_does_not(self):
        for level, expected in (("DEBUG", True), ("INFO", False)):
            with self.subTest(level):
                os.environ["QUILTOR_LOG_LEVEL"] = level
                observability, stderr = self.build()
                observability.logger.event(
                    "debug", "http.access", method="GET", route="client_asset"
                )
                self.assertEqual('"route": "client_asset"' in stderr.getvalue(), expected)

    def test_the_start_writes_one_configured_line(self):
        os.environ["QUILTOR_LOG_FILE"] = str(self.root / "log" / "q.log")
        os.environ["QUILTOR_LOG_LEVEL"] = "info"
        _, stderr = self.build()
        lines = [line for line in stderr.getvalue().splitlines() if "logging.configured" in line]
        self.assertEqual(len(lines), 1, stderr.getvalue())
        record = json.loads(lines[0])
        self.assertEqual(record["level"], "info")  # severity of the line, not overwritten
        self.assertEqual(record["log_level"], "info")  # the configured level, separate field
        self.assertIn("q.log", record["file"])

    def test_an_invalid_level_stops_the_start_with_exit_2(self):
        os.environ["QUILTOR_LOG_LEVEL"] = "loud"
        captured = io.StringIO()
        with patch.object(sys, "stderr", captured), self.assertRaises(SystemExit) as raised:
            build_observability()
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("QUILTOR_LOG_LEVEL", captured.getvalue())


class LogFileTests(_Isolated):
    def test_lines_reach_stderr_and_the_file_and_the_directory_is_created(self):
        target = self.root / "deep" / "dir" / "server.log"
        os.environ["QUILTOR_LOG_FILE"] = str(target)
        observability, stderr = self.build()
        observability.logger.event("info", "http.access", method="GET", route="/api/version")
        for handler in logging.getLogger("quiltor").handlers:
            handler.flush()
        text = target.read_text(encoding="utf-8")
        self.assertIn('"route": "/api/version"', text)
        self.assertIn('"route": "/api/version"', stderr.getvalue())

    def test_the_file_rotates_into_numbered_backups(self):
        target = self.root / "server.log"
        os.environ["QUILTOR_LOG_FILE"] = str(target)
        with patch.object(log_stdlib, "_LOG_FILE_MAX_BYTES", 400):
            observability, _ = self.build()
            for number in range(40):
                observability.logger.event(
                    "info", "http.access", method="GET", route=f"/api/r{number}", status=200
                )
        names = sorted(path.name for path in self.root.iterdir())
        self.assertEqual(names[:3], ["server.log", "server.log.1", "server.log.2"])
        self.assertLessEqual(len(names), 6)  # the live file plus five backups

    def test_a_directory_that_cannot_be_written_stops_the_start(self):
        blocker = self.root / "plain-file"
        blocker.write_text("x", encoding="utf-8")
        os.environ["QUILTOR_LOG_FILE"] = str(blocker / "server.log")  # parent is a file
        captured = io.StringIO()
        with patch.object(sys, "stderr", captured), self.assertRaises(SystemExit) as raised:
            build_observability()
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("QUILTOR_LOG_FILE", captured.getvalue())

    def test_a_second_build_does_not_keep_writing_to_the_first_file(self):
        first, second = self.root / "a.log", self.root / "b.log"
        os.environ["QUILTOR_LOG_FILE"] = str(first)
        self.build()
        os.environ["QUILTOR_LOG_FILE"] = str(second)
        observability, _ = self.build()
        observability.logger.event("info", "http.access", route="/api/x")
        self.assertNotIn("/api/x", first.read_text(encoding="utf-8"))
        self.assertIn("/api/x", second.read_text(encoding="utf-8"))


class NoConfigurationTests(_Isolated):
    def test_without_variables_there_is_one_stderr_handler_at_info_and_no_file(self):
        before = set(self.root.rglob("*"))
        observability, _ = self.build()
        logger = logging.getLogger("quiltor")
        owned = [handler for handler in logger.handlers if getattr(handler, OWNED, False)]
        self.assertEqual(len(owned), 1)
        self.assertIs(type(owned[0]), logging.StreamHandler)
        self.assertEqual(logger.level, logging.INFO)
        self.assertEqual(set(self.root.rglob("*")), before)
        self.assertIsNotNone(observability.logger)


class DesktopDefaultTests(_Isolated):
    class _Stop(Exception):
        pass

    def run_main(self, stderr):
        logs = self.root / "logs"
        dirs = SimpleNamespace(data=self.root / "home" / "data", logs=logs)
        dirs.ensure = lambda: dirs  # type: ignore[attr-defined]
        os.environ.pop("QUILTOR_RUNTIME_HOST", None)
        with (
            patch.object(sys, "stderr", stderr),
            patch.object(desktop_app.directories, "current", return_value=dirs),
            patch("quiltor.hosts.web.server.build_web_application", side_effect=self._Stop),
            contextlib.suppress(self._Stop),
        ):
            desktop_app.main()
        return logs

    def test_window_mode_logs_to_a_file_in_the_logs_directory(self):
        logs = self.run_main(None)
        self.assertEqual(Path(os.environ["QUILTOR_LOG_FILE"]), logs / "quiltor-server.log")

    def test_a_console_keeps_the_log_on_the_console(self):
        self.run_main(io.StringIO())
        self.assertNotIn("QUILTOR_LOG_FILE", os.environ)

    def test_a_file_the_user_chose_is_not_overridden(self):
        os.environ["QUILTOR_LOG_FILE"] = str(self.root / "mine.log")
        self.run_main(None)
        self.assertEqual(os.environ["QUILTOR_LOG_FILE"], str(self.root / "mine.log"))


if __name__ == "__main__":
    unittest.main()
