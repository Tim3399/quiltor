import ast
import inspect
import unittest
from pathlib import Path

from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache

from quiltor.modules.assistant import (
    AssistantRuntime,
    CONVERSATION_HISTORY_TOKEN_BUDGET,
    conversation_messages,
    required_proposal_kinds,
    task_contract,
)


FIGURES = {
    "nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}],
    "edges": [],
    "timeline": [],
}

ASSISTANT_MODULES = Path(__file__).resolve().parents[2] / "src/quiltor/modules/assistant"


class AssistantRuntimeArchitectureTests(unittest.TestCase):
    def test_runtime_is_a_small_orchestrator_with_owned_policy_modules(self):
        ownership = {
            "prompts.py": {"system_prompt"},
            "conversation.py": {"conversation_messages", "fit_to_budget"},
            "completion.py": {"complete_request"},
            "batch.py": {"run_batches"},
            "planner.py": {"plan", "needs_planner"},
            "proposals.py": {"forced_proposal"},
        }
        for filename, expected_functions in ownership.items():
            tree = ast.parse((ASSISTANT_MODULES / filename).read_text(encoding="utf-8"))
            functions = {
                node.name
                for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
            self.assertTrue(expected_functions <= functions, filename)

        runtime_path = ASSISTANT_MODULES / "runtime.py"
        runtime_source = runtime_path.read_text(encoding="utf-8")
        self.assertLessEqual(len(runtime_source.splitlines()), 220)
        runtime_tree = ast.parse(runtime_source)
        runtime_class = next(
            node
            for node in runtime_tree.body
            if isinstance(node, ast.ClassDef) and node.name == "AssistantRuntime"
        )
        complete_method = next(
            node
            for node in runtime_class.body
            if isinstance(node, ast.FunctionDef) and node.name == "complete"
        )
        delegated_calls = {
            call.func.id
            for call in ast.walk(complete_method)
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
        }
        self.assertIn("complete_request", delegated_calls)
        self.assertEqual(sum(isinstance(node, ast.Return) for node in complete_method.body), 1)

    def test_assistant_product_modules_do_not_import_infrastructure(self):
        violations = []
        for path in ASSISTANT_MODULES.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                modules = []
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    modules = [node.module]
                for module in modules:
                    if module == "quiltor.infrastructure" or module.startswith(
                        "quiltor.infrastructure."
                    ):
                        violations.append(f"{path.name}:{node.lineno}:{module}")
        self.assertEqual(violations, [])


class _Progress:
    def start(self, *args):
        pass

    def update(self, *args):
        pass

    def finish(self, *args):
        pass

    def read(self, *args):
        return None


def _messages(history, counter):
    return conversation_messages(history, "http://mock", counter, BoundedTokenCountCache())


class ConversationMessagesTests(unittest.TestCase):
    def test_keeps_recent_history_within_the_real_token_budget(self):
        history = [{"role": "user", "content": f"turn {i}"} for i in range(6)]
        calls = []
        counter = lambda text: calls.append(text) or CONVERSATION_HISTORY_TOKEN_BUDGET // 3
        result = _messages(history, counter)
        # Budget fits exactly 3 messages of that size -- the 3 most recent, oldest-first in the output.
        self.assertEqual([item["content"] for item in result], ["turn 3", "turn 4", "turn 5"])
        self.assertEqual(calls, ["turn 5", "turn 4", "turn 3", "turn 2"])

    def test_stops_at_the_first_message_that_does_not_fit_even_if_older_ones_would(self):
        history = [
            {"role": "user", "content": "old, would fit alone"},
            {"role": "assistant", "content": "too big to include"},
            {"role": "user", "content": "newest"},
        ]
        # Walking newest-first: "newest" fits, "too big to include" doesn't -- stop there,
        # never even consider "old, would fit alone" even though it's small.
        values = iter([10, CONVERSATION_HISTORY_TOKEN_BUDGET + 1])
        result = _messages(history, lambda _text: next(values))
        self.assertEqual([item["content"] for item in result], ["newest"])

    def test_filters_out_non_conversational_roles_and_empty_content(self):
        history = [
            {"role": "system", "content": "ignored role"},
            {"role": "user", "content": ""},
            {"role": "user", "content": "kept"},
        ]
        calls = []
        result = _messages(history, lambda text: calls.append(text) or 1)
        self.assertEqual([item["content"] for item in result], ["kept"])
        self.assertEqual(calls, ["kept"])

    def test_empty_history_never_calls_the_tokenizer(self):
        calls = []
        result = _messages(None, lambda text: calls.append(text) or 1)
        self.assertEqual(result, [])
        self.assertEqual(calls, [])


class FakeInference:
    identity = "http://mock"

    def __init__(self, replies=None, tokens=0):
        self.replies = list(replies or [])
        self.tokens = tokens
        self.calls = []

    def reload(self):
        pass

    def status(self):
        return {"available": True, "mode": "local", "reason": ""}

    def invoke(self, payload):
        self.calls.append(payload)
        if not self.replies:
            raise AssertionError("unexpected inference call")
        return dict(self.replies.pop(0))

    def count_tokens(self, text):
        return self.tokens

    def close(self):
        pass


class CrossTurnReferenceResolutionCharacterizationTests(unittest.TestCase):
    """Characterization tests for plan item D.7, not a fix: they pin down current behavior
    (the deterministic contract layer only ever looks at the *current* question) so a future
    change to cross-turn reference resolution has a documented baseline to diff against."""

    def test_task_contract_and_required_proposal_kinds_do_not_accept_history_at_all(self):
        self.assertNotIn("history", inspect.signature(task_contract).parameters)
        self.assertNotIn("history", inspect.signature(required_proposal_kinds).parameters)

    def test_an_ambiguous_pronoun_follow_up_is_classified_from_the_current_question_alone(self):
        # "Lege auch seine Schwester an." structurally reads as a creation + family-relationship
        # request regardless of who "seine" (his) refers to -- the deterministic layer gets the
        # *kind* of operation right without needing history. Resolving "seine" to a specific prior
        # entity is left entirely to the LLM via conversation_messages()'s raw history text; there is
        # no test anywhere proving that resolution actually works, only that the contract layer
        # doesn't attempt or need it for kind classification.
        with_context = required_proposal_kinds("Lege auch seine Schwester an.")
        without_context = required_proposal_kinds("Lege auch seine Schwester an.")
        self.assertEqual(with_context, without_context)
        self.assertEqual(with_context, {"create_element", "create_relationship"})

    def test_identical_current_question_yields_an_identical_contract_regardless_of_prior_turns(
        self,
    ):
        # task_contract has no way to distinguish "first message in a chat" from "20th message" --
        # its output is a pure function of (question, figures). This is the concrete gap D.7 flags:
        # a follow-up like "also add his sister" is contract-classified the same whether or not the
        # preceding turn actually established who "his" is.
        figures = {**FIGURES}
        self.assertEqual(
            task_contract("Und seine Schwester?", figures),
            task_contract("Und seine Schwester?", figures),
        )


class AssistantRuntimeCompleteTests(unittest.TestCase):
    def _runtime(self, *replies, tokens=0):
        inference = FakeInference(replies, tokens)
        return (
            AssistantRuntime(
                Path("."),
                Path("."),
                inference,
                progress=_Progress(),
                token_cache=BoundedTokenCountCache(),
            ),
            inference,
        )

    def test_happy_path_returns_the_model_reply_with_sources_resolved(self):
        # Simple facts bypass the planner and need a single answer call.
        reply = {"message": "Alles bereit.", "citations": [], "proposals": []}
        runtime, inference = self._runtime(reply)
        result = runtime.complete("Wie geht es Tarek?", {}, FIGURES, history=None)
        self.assertEqual(result["message"], "Alles bereit.")
        self.assertEqual(result["proposals"], [])
        self.assertEqual(len(inference.calls), 1)

    def test_complex_planner_gets_a_deterministic_search_seed_when_model_returns_none(self):
        planner_reply = {"goal": "audit", "steps": [], "searchQueries": [], "requiredKinds": []}
        runtime, _ = self._runtime(planner_reply)
        plan = runtime._plan("Prüfe Manuskript und Timeline auf Konsistenz.", [])
        self.assertEqual(plan["searchQueries"], ["Prüfe Manuskript und Timeline auf Konsistenz."])

    def test_deterministic_fallback_avoids_repair_when_a_required_proposal_is_unambiguous(self):
        empty = {"message": "...", "citations": [], "proposals": []}
        runtime, inference = self._runtime(empty)
        result = runtime.complete("Lege Igor als neue Figur an.", {}, FIGURES, history=None)
        self.assertEqual(len(inference.calls), 1)
        self.assertEqual([item["kind"] for item in result["proposals"]], ["create_element"])
        self.assertEqual(result["proposals"][0]["element"]["name"], "Igor")
        steps = [item["step"] for item in result["agentTrace"]]
        self.assertIn("deterministic_fallback", steps)

    def test_board_arrangement_has_a_deterministic_fallback(self):
        runtime, _ = self._runtime()
        proposal = runtime._forced_proposal(
            "Sortiere das Figurenboard in einem Raster neu.", "[]", FIGURES
        )
        self.assertEqual(proposal, {"kind": "arrange_elements", "strategy": "grid"})

    def test_batch_orchestration_uses_ports_and_carries_proposals_between_groups(self):
        events = []

        class RecordingProgress(_Progress):
            def start(self, *args):
                events.append(("start", args))

            def update(self, *args):
                events.append(("update", args))

            def finish(self, *args):
                events.append(("finish", args))

        runtime, _ = self._runtime(tokens=2000)
        runtime.progress = RecordingProgress()
        calls = []

        def complete(_question, _manuscript, figures, _history, *, chapter_ids, **_options):
            calls.append((list(chapter_ids), figures))
            chapter_id = chapter_ids[0]
            return {
                "message": chapter_id,
                "proposals": [
                    {
                        "kind": "create_element",
                        "tempId": f"new:{chapter_id}",
                        "element": {"type": "person", "name": chapter_id},
                    }
                ],
            }

        runtime.complete = complete
        result = runtime._run_batches(
            "Prüfe alles",
            {
                "chapters": [
                    {"id": "c1", "title": "Eins", "body": "a"},
                    {"id": "c2", "title": "Zwei", "body": "b"},
                ]
            },
            FIGURES,
            None,
            "progress-1",
            owner_sub="owner",
            world_id="world",
        )
        self.assertEqual([chapter_ids for chapter_ids, _figures in calls], [["c1"], ["c2"]])
        self.assertIn("new:c1", {node["id"] for node in calls[1][1]["nodes"]})
        self.assertEqual(len(result["proposals"]), 2)
        self.assertEqual(
            [event for event, _args in events], ["start", "update", "update", "finish"]
        )

    def test_explicitly_picked_chapters_are_forced_into_context_even_when_retrieval_would_miss_them(
        self,
    ):
        # Plan B.4: an author-picked chapter range should always reach the model, not depend
        # on retrieve()'s lexical scoring guessing the question is about that chapter.
        manuscript = {
            "chapters": [
                {
                    "id": "c1",
                    "title": "Weit weg",
                    "body": "Ganz andere Worte, die nichts mit der Frage zu tun haben.",
                    "note": "",
                }
            ]
        }
        reply = {"message": "ok", "citations": [], "proposals": []}
        runtime, inference = self._runtime(reply)
        runtime.complete(
            "Fasse das bitte allgemein zusammen.",
            manuscript,
            FIGURES,
            history=None,
            chapter_ids=["c1"],
        )
        sent_content = inference.calls[0]["messages"][-1]["content"]
        self.assertIn("Ganz andere Worte", sent_content)

    def test_chapter_ids_that_match_nothing_do_not_break_a_normal_request(self):
        reply = {"message": "ok", "citations": [], "proposals": []}
        runtime, _ = self._runtime(reply)
        result = runtime.complete(
            "Wie geht es Tarek?", {}, FIGURES, history=None, chapter_ids=["does-not-exist"]
        )
        self.assertEqual(result["message"], "ok")

    def test_conversation_history_is_folded_into_the_first_payload(self):
        history = [
            {"role": "user", "content": "Wer ist Tarek?"},
            {"role": "assistant", "content": "Ein Ritter."},
        ]
        reply = {"message": "ok", "citations": [], "proposals": []}
        runtime, inference = self._runtime(reply, tokens=1)
        runtime.complete("Und seine Familie?", {}, FIGURES, history=history)
        sent_messages = inference.calls[0]["messages"]
        roles_and_content = [
            (item["role"], item["content"])
            for item in sent_messages
            if item["role"] in {"user", "assistant"}
        ][:2]
        self.assertEqual(
            roles_and_content, [("user", "Wer ist Tarek?"), ("assistant", "Ein Ritter.")]
        )


if __name__ == "__main__":
    unittest.main()
