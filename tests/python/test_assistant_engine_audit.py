"""T-61 part 9: the audit names the engine, the relay deadlines come from the environment.

The audit records only the kind of engine (`server`, `webllm`, `cloud`), never a model name
or a key. The interaction table gains the column in schema 16; older rows read `server`.
"""

from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from typing import Any

from quiltor.bootstrap.application import relay_deadlines
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.infrastructure.persistence.sqlite import assistant_history, migrations, schema
from quiltor.modules.assistant.engines import SERVER, WEBLLM
from quiltor.modules.assistant.jobs import AssistantJobRunner
from tests.python.test_assistant_jobs import (
    WORLD_ID,
    FakeWorldAccess,
    SilentLogger,
    TestMetrics,
    create_world_file,
    execution,
    intent,
)


class _RecordingLogger:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def record(
        self, question, response=None, *, error="", owner_sub="", world_id="", engine="server"
    ):
        self.records.append({"response": response, "error": error, "engine": engine})
        return f"interaction-{len(self.records)}"


class _Answering:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def reload(self) -> None:
        pass

    def close(self) -> None:
        pass

    def complete(self, question, *args, **kwargs):
        if self.fail:
            raise RuntimeError("model gone")
        return {
            "message": question,
            "proposals": [],
            "sources": [],
            "agentTrace": [{"step": "plan"}],
        }


class EngineInTheAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        create_world_file(self.data)
        self.logger = _RecordingLogger()

    def tearDown(self) -> None:
        time.sleep(0.2)
        self.tmp.cleanup()

    def _run(self, engine: str, *, fail: bool = False) -> dict[str, Any]:
        runner = AssistantJobRunner(
            _Answering(fail),
            store_factory=lambda: AssistantJobStore(self.data / "assistant-jobs.sqlite3"),
            interaction_logger=self.logger,
            world_access=FakeWorldAccess(self.data),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            client_runtime_factory=lambda job, request: _Answering(fail),
        )
        try:
            job, _ = runner.submit(
                owner_sub="alice",
                world_id=WORLD_ID,
                idempotency_key=f"key-{engine}",
                intent=intent(engine),
                execution=execution(engine),
                engine_kind=engine,
            )
            return runner.wait(job["id"], "alice", WORLD_ID, timeout=3)
        finally:
            runner.close()

    def test_each_engine_kind_is_recorded_in_trace_and_interaction(self):
        for engine in (SERVER, WEBLLM):
            with self.subTest(engine=engine):
                done = self._run(engine)
                self.assertEqual(done["status"], "completed")
                record = self.logger.records[-1]
                self.assertEqual(record["engine"], engine)
                trace = record["response"]["agentTrace"]
                self.assertEqual(trace[0], {"step": "engine", "engine": engine})
                self.assertEqual(trace[1], {"step": "plan"})

    def test_a_failed_job_names_its_engine_too(self):
        self._run(WEBLLM, fail=True)
        self.assertEqual(self.logger.records[-1]["engine"], WEBLLM)
        self.assertEqual(self.logger.records[-1]["error"], "model gone")


class InteractionEngineColumnTests(unittest.TestCase):
    def test_a_recorded_interaction_reads_back_its_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "world.sqlite3"
            schema.initialize(database)
            assistant_history.log_interaction("q1", {"message": "a"}, db_path=database)
            assistant_history.log_interaction(
                "q2", {"message": "b"}, db_path=database, engine=WEBLLM
            )
            engines = {
                row["question"]: row["engine"]
                for row in assistant_history.list_interactions(db_path=database)
            }
            self.assertEqual(engines, {"q1": SERVER, "q2": WEBLLM})

    def test_schema_16_adds_the_column_and_old_rows_read_server(self):
        with closing(sqlite3.connect(":memory:")) as database:
            database.execute(
                "CREATE TABLE assistant_interactions (id TEXT PRIMARY KEY, created_at TEXT NOT"
                " NULL, question TEXT NOT NULL, response_json TEXT, status TEXT NOT NULL,"
                " error TEXT NOT NULL DEFAULT '')"
            )
            database.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
            database.execute(
                "INSERT INTO assistant_interactions VALUES('old','t','q',NULL,'completed','')"
            )
            migrations.migrate(database, 15)
            migrations.migrate(database, 15)  # idempotent
            row = database.execute("SELECT engine FROM assistant_interactions").fetchone()
            self.assertEqual(row[0], SERVER)

    def test_schema_16_leaves_a_meta_only_database_alone(self):
        with closing(sqlite3.connect(":memory:")) as database:
            database.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
            migrations.migrate(database, 15)
            tables = {
                row[0]
                for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            self.assertEqual(tables, {"meta"})


class RelayDeadlineTests(unittest.TestCase):
    def test_unset_means_the_defaults(self):
        deadlines = relay_deadlines({})
        self.assertEqual(deadlines.answer_seconds, {"webllm": 300.0, "cloud": 120.0})
        self.assertEqual(deadlines.job_seconds, 20 * 60.0)

    def test_values_inside_the_bounds_are_taken(self):
        deadlines = relay_deadlines(
            {
                "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM": "3600",
                "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD": "10",
                "QUILTOR_ASSISTANT_RELAY_JOB_MINUTES": " 1 ",
            }
        )
        self.assertEqual(deadlines.answer_seconds, {"webllm": 3600.0, "cloud": 10.0})
        self.assertEqual(deadlines.job_seconds, 60.0)

    def test_out_of_bounds_stops_the_start_without_the_value(self):
        cases = {
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM": ("29", "3601", "abc", "1.5", "-5"),
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD": ("9", "601", "0"),
            "QUILTOR_ASSISTANT_RELAY_JOB_MINUTES": ("0", "121", "٣"),
        }
        bounds = {
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM": "30 to 3600",
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD": "10 to 600",
            "QUILTOR_ASSISTANT_RELAY_JOB_MINUTES": "1 to 120",
        }
        for name, values in cases.items():
            for value in values:
                with self.subTest(name=name, value=value):
                    with self.assertRaises(RuntimeError) as raised:
                        relay_deadlines({name: value})
                    self.assertEqual(
                        str(raised.exception),
                        f"{name} must be a whole number from {bounds[name]}.",
                    )

    def test_the_cli_lists_every_deadline_variable(self):
        from quiltor.hosts.cli import main

        source = Path(main.__file__).read_text(encoding="utf-8")
        for name in (
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM",
            "QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD",
            "QUILTOR_ASSISTANT_RELAY_JOB_MINUTES",
        ):
            self.assertIn(f'"{name}"', source)


if __name__ == "__main__":
    unittest.main()
