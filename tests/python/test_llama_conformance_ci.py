"""The llama-conformance CI script, without a download (D-94).

The script fetches a real llama-server only in CI. What can be checked here is everything
around that: how a run is graded, which models may be used, that the server is started with the
product's arguments, and that the whole pipeline runs against a server that needs no download
(the bridge with fakes).
"""

from __future__ import annotations

import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from conformance_support import fake_state, load_bridge, start_bridge

from quiltor.infrastructure.inference.install_manifest import LLAMA_CPP_RELEASE
from quiltor.infrastructure.inference.runtimes import llamacpp

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "llama_conformance_under_test", ROOT / "tools/ci/llama_conformance.py"
)
assert _spec is not None and _spec.loader is not None
script = importlib.util.module_from_spec(_spec)
# A dataclass looks its own module up by name while it is being defined.
sys.modules[_spec.name] = script
_spec.loader.exec_module(script)

WORKFLOW = (ROOT / ".github/workflows/llama-conformance.yml").read_text(encoding="utf-8")


def outcome(case: str, status: str) -> object:
    return script.CaseOutcome(case, status)


class GradingTests(unittest.TestCase):
    def test_nothing_failed_is_conformant(self):
        verdict = script.grade([outcome("C01", "pass"), outcome("C39", "skip")], {})
        self.assertEqual(verdict.verdict, script.CONFORMANT)
        self.assertEqual(verdict.skipped, ("C39",))

    def test_a_failure_on_the_list_is_known_not_hidden(self):
        outcomes = [outcome("C01", "pass"), outcome("C22", "fail")]
        verdict = script.grade(outcomes, {"C22": ["N1"]})
        self.assertEqual(verdict.verdict, script.KNOWN_DEVIATIONS)
        self.assertEqual(verdict.failed, ("C22",))
        self.assertEqual(verdict.known, {"C22": ["N1"]})

    def test_a_failure_nobody_named_is_not_conformant(self):
        outcomes = [outcome("C22", "fail"), outcome("C20", "fail")]
        verdict = script.grade(outcomes, {"C22": ["N1"]})
        self.assertEqual(verdict.verdict, script.NOT_CONFORMANT)
        self.assertEqual(verdict.unexpected, ("C20",))

    def test_a_listed_case_that_passes_is_reported_as_stale(self):
        verdict = script.grade([outcome("C22", "pass")], {"C22": ["N1"]})
        self.assertEqual(verdict.verdict, script.CONFORMANT)
        self.assertEqual(verdict.stale, ("C22",))

    def test_the_summary_says_which_cases_are_known_and_which_are_not(self):
        outcomes = [outcome("C22", "fail"), outcome("C20", "fail")]
        verdict = script.grade(outcomes, {"C22": ["N1"]})
        text = script.render_summary(
            release="bX",
            model=None,
            model_digest=None,
            verdict=verdict,
            outcomes=outcomes,
            spike=False,
        )
        self.assertIn("not-conformant", text)
        self.assertIn("known: N1", text)
        self.assertIn("Not on the list of known deviations:** C20", text)


class PinTests(unittest.TestCase):
    def test_a_model_without_a_digest_runs_only_in_a_spike(self):
        model = {"name": "m", "sha256": None}
        with self.assertRaisesRegex(script.PinError, "no pinned sha256"):
            script.require_pin(model, spike=False)
        script.require_pin(model, spike=True)
        script.require_pin({"name": "m", "sha256": "a" * 64}, spike=False)

    def test_the_pins_file_is_well_formed(self):
        pins = script.load_pins()
        self.assertTrue(pins["models"])
        for model in pins["models"]:
            self.assertRegex(model["repo"], r"^[\w.-]+/[\w.-]+$")
            self.assertTrue(model["file"].endswith(".gguf"))
            self.assertNotIn("/", model["file"])
            self.assertGreater(model["approximate_bytes"], 0)

    def test_the_pins_name_exactly_the_approved_smollm2_and_nothing_else(self):
        """Only SmolLM2 135M is approved for download; no second candidate, no fallback."""
        models = script.load_pins()["models"]
        self.assertEqual([m["name"] for m in models], ["smollm2-135m-instruct"])
        self.assertEqual(models[0]["repo"], "bartowski/SmolLM2-135M-Instruct-GGUF")
        self.assertEqual(models[0]["file"], "SmolLM2-135M-Instruct-Q8_0.gguf")
        self.assertEqual(models[0]["revision"], "09816acd5d99df7be770d85ea30822623dab342c")
        self.assertEqual(list(script.APPROVED_MODELS), ["smollm2-135m-instruct"])

    def test_a_second_or_other_model_in_the_pins_is_refused(self):
        pins = json.loads(script.PINS_PATH.read_text(encoding="utf-8"))
        qwen = {
            "name": "qwen2.5-0.5b-instruct",
            "repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
            "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "license": "Apache-2.0",
            "approximate_bytes": 491000000,
            "sha256": None,
        }
        swapped = dict(pins["models"][0], repo="someone/SmolLM2-135M-Instruct-GGUF")
        moved = dict(pins["models"][0], revision="0" * 40)
        for name, models in (
            ("a fallback after SmolLM2", [*pins["models"], qwen]),
            ("another model instead", [qwen]),
            ("SmolLM2 from another repository", [swapped]),
            ("SmolLM2 at another revision", [moved]),
            ("no model", []),
        ):
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "pins.json"
                path.write_text(json.dumps(dict(pins, models=models)), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "exactly the approved models"):
                    script.load_pins(path)

    def test_the_download_is_pinned_to_the_approved_revision(self):
        """The CI script hands the pinned revision to the installer instead of resolving main."""
        from quiltor.infrastructure.inference import installer

        model = script.load_pins()["models"][0]
        with (
            tempfile.TemporaryDirectory() as home,
            patch.object(installer, "install_runtime"),
            patch.object(installer, "install_model") as fetch,
            redirect_stdout(io.StringIO()),
        ):
            script.install(Path(home), LLAMA_CPP_RELEASE, model)
        self.assertEqual(fetch.call_args.kwargs["revision"], model["revision"])

    def test_main_never_tries_a_model_that_is_not_approved(self):
        """Even if the pins check were bypassed, main downloads only what load_pins returned."""
        pins = json.loads(script.PINS_PATH.read_text(encoding="utf-8"))
        installed: list[str] = []

        def refuse(home, release, model):
            installed.append(model["name"])
            raise OSError("no download in tests")

        with (
            patch.object(script, "install", side_effect=refuse),
            redirect_stdout(io.StringIO()),
            patch("sys.stderr", io.StringIO()),
        ):
            code = script.main(["--spike"])
        self.assertEqual(code, 2)
        self.assertEqual(installed, [m["name"] for m in pins["models"]])
        self.assertEqual(installed, ["smollm2-135m-instruct"])

    def test_a_malformed_digest_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "pins.json")
            model = {
                "name": "smollm2-135m-instruct",
                "repo": "bartowski/SmolLM2-135M-Instruct-GGUF",
                "file": "SmolLM2-135M-Instruct-Q8_0.gguf",
                "revision": "09816acd5d99df7be770d85ea30822623dab342c",
                "sha256": "ABC",
            }
            bad = {"models": [model], "known_deviations": {}}
            path.write_text(json.dumps(bad), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "sha256"):
                script.load_pins(path)

    def test_the_products_pin_has_a_deviation_entry_so_a_bump_is_a_decision(self):
        self.assertIn(LLAMA_CPP_RELEASE, script.load_pins()["known_deviations"])

    def test_the_workflow_matrix_only_names_releases_that_have_an_entry(self):
        match = re.search(r"release: \[([^\]]+)\]", WORKFLOW)
        assert match is not None
        releases = [name.strip() for name in match.group(1).split(",")]
        self.assertIn(LLAMA_CPP_RELEASE, releases)
        self.assertLessEqual(set(releases), set(script.load_pins()["known_deviations"]))


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "llama-conformance"


class RecordedRunTests(unittest.TestCase):
    """The first real run (42884579021), replayed and graded exactly as CI grades it."""

    def replay(self, release: str) -> tuple[int, str]:
        output = io.StringIO()
        with redirect_stdout(output):
            code = script.main(
                ["--release", release, "--replay", str(FIXTURES / f"llama-answers-{release}.jsonl")]
            )
        return code, output.getvalue()

    def test_each_pin_is_conformant_with_known_deviations(self):
        for release in ("b10218", "b12183"):
            with self.subTest(release=release):
                code, summary = self.replay(release)
                self.assertEqual(code, 0, summary)
                self.assertIn(f"llama-server {release}: {script.KNOWN_DEVIATIONS}", summary)
                self.assertNotIn("Listed as deviating but passing now", summary)

    def test_a_recorded_line_is_graded_like_ci(self):
        """C02 as recorded: 200 to a request without model -- N22 on the list."""
        line = json.loads(
            (FIXTURES / "llama-answers-b10218.jsonl").read_text(encoding="utf-8").splitlines()[1]
        )
        self.assertEqual((line["case"], line["status"]), ("C02", 200))
        _, summary = self.replay("b10218")
        self.assertRegex(summary, r"\| C02 \| fail \| known: N22\. ")

    def test_the_recorded_context_error_shows_n1_to_n3_on_each_pin(self):
        """C20 as recorded: the context error comes back, but not in the contract envelope."""
        for release in ("b10218", "b12183"):
            with self.subTest(release=release):
                _, summary = self.replay(release)
                self.assertRegex(
                    summary,
                    r"\| C20 \| fail \| known: N1, N2, N3\. .*envelope deviations: N1, N2, N3",
                )

    def test_a_deviation_dropped_from_the_list_turns_the_run_red(self):
        pins = script.load_pins()
        for release in ("b10218", "b12183"):
            for case in pins["known_deviations"][release]:
                with self.subTest(release=release, case=case):
                    fewer = json.loads(json.dumps(pins))
                    del fewer["known_deviations"][release][case]
                    with patch.object(script, "load_pins", return_value=fewer):
                        code, summary = self.replay(release)
                    self.assertEqual(code, 1, summary)
                    self.assertIn(f"Not on the list of known deviations:** {case}", summary)

    def test_every_listed_deviation_names_a_contract_code_or_says_it_is_open(self):
        for release, cases in script.load_pins()["known_deviations"].items():
            for case, codes in cases.items():
                for code in codes:
                    with self.subTest(release=release, case=case):
                        self.assertRegex(code, r"^(N\d+|open: .+)$")


class StartTests(unittest.TestCase):
    def test_the_server_starts_with_the_products_arguments_and_the_key_stays_out_of_argv(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            binary = home / "runtime" / llamacpp.binary_name()
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"")
            models = home / "models"
            models.mkdir(exist_ok=True)
            (models / "m.gguf").write_bytes(b"")
            captured: dict = {}

            def spawn(argv, data, log_name, env=None):
                captured.update(argv=argv, env=env)
                return object(), data / log_name

            with (
                patch.object(llamacpp, "spawn_logged", spawn),
                patch.object(llamacpp, "model_store") as store,
            ):
                store.return_value.gguf = models
                script.start_server(home, 4321, "sekret")
        argv = captured["argv"]
        self.assertEqual(argv[0], str(binary))
        self.assertEqual(argv[1], "-m")
        for expected in ("--host", "127.0.0.1", "--port", "4321", "-c", "8192", "--jinja"):
            self.assertIn(expected, argv)
        self.assertNotIn("sekret", " ".join(argv))
        self.assertEqual(captured["env"], {"LLAMA_API_KEY": "sekret"})


class PipelineTests(unittest.TestCase):
    """The whole path from a server's answers to an exit code, against the bridge."""

    def run_against_bridge(self, **fakes) -> tuple[int, str, list[dict]]:
        bridge = load_bridge()
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.dict(bridge.STATE, fake_state(bridge, **fakes)),
        ):
            server, url = start_bridge(bridge)
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            artifact = Path(folder, "answers.jsonl")
            summary = Path(folder, "summary.md")
            with redirect_stdout(io.StringIO()):
                code = script.main(
                    ["--server-url", url, "--artifact", str(artifact), "--summary", str(summary)]
                )
            lines = [json.loads(line) for line in artifact.read_text("utf-8").splitlines()]
            return code, summary.read_text("utf-8"), lines

    def test_a_conformant_server_exits_zero_and_keeps_one_line_per_case(self):
        code, summary, lines = self.run_against_bridge()
        self.assertEqual(code, 0, summary)
        self.assertIn(": conformant", summary)
        self.assertEqual(
            sorted(line["case"] for line in lines),
            ["C01", "C02", "C03", "C17", "C20", "C22", "C39", "C40a"],
        )

    def test_a_server_that_breaks_a_case_exits_one_and_names_the_case(self):
        code, summary, _ = self.run_against_bridge(fail_with="the model crashed")
        self.assertEqual(code, 1, summary)
        self.assertIn("not-conformant", summary)
        self.assertRegex(summary, r"\| C01 \| fail \|")


if __name__ == "__main__":
    unittest.main()
