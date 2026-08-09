import inspect
import unittest
from unittest.mock import patch

from backend.assistant import AssistantRuntime, CONVERSATION_HISTORY_TOKEN_BUDGET, conversation_messages, required_proposal_kinds, task_contract


FIGURES = {"nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}], "edges": [], "timeline": []}


class ConversationMessagesTests(unittest.TestCase):
    def test_keeps_recent_history_within_the_real_token_budget(self):
        history = [{"role": "user", "content": f"turn {i}"} for i in range(6)]
        with patch("backend.assistant.runtime.count_tokens", return_value=CONVERSATION_HISTORY_TOKEN_BUDGET // 3) as counter:
            result = conversation_messages(history, "http://mock")
        # Budget fits exactly 3 messages of that size -- the 3 most recent, oldest-first in the output.
        self.assertEqual([item["content"] for item in result], ["turn 3", "turn 4", "turn 5"])
        for call in counter.call_args_list:
            self.assertEqual(call.args[0], "http://mock")

    def test_stops_at_the_first_message_that_does_not_fit_even_if_older_ones_would(self):
        history = [
            {"role": "user", "content": "old, would fit alone"},
            {"role": "assistant", "content": "too big to include"},
            {"role": "user", "content": "newest"},
        ]
        # Walking newest-first: "newest" fits, "too big to include" doesn't -- stop there,
        # never even consider "old, would fit alone" even though it's small.
        with patch("backend.assistant.runtime.count_tokens", side_effect=[10, CONVERSATION_HISTORY_TOKEN_BUDGET + 1]):
            result = conversation_messages(history, "http://mock")
        self.assertEqual([item["content"] for item in result], ["newest"])

    def test_filters_out_non_conversational_roles_and_empty_content(self):
        history = [
            {"role": "system", "content": "ignored role"},
            {"role": "user", "content": ""},
            {"role": "user", "content": "kept"},
        ]
        with patch("backend.assistant.runtime.count_tokens", return_value=1) as counter:
            result = conversation_messages(history, "http://mock")
        self.assertEqual([item["content"] for item in result], ["kept"])
        counter.assert_called_once()

    def test_empty_history_never_calls_the_tokenizer(self):
        with patch("backend.assistant.runtime.count_tokens") as counter:
            result = conversation_messages(None, "http://mock")
        self.assertEqual(result, [])
        counter.assert_not_called()


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

    def test_identical_current_question_yields_an_identical_contract_regardless_of_prior_turns(self):
        # task_contract has no way to distinguish "first message in a chat" from "20th message" --
        # its output is a pure function of (question, figures). This is the concrete gap D.7 flags:
        # a follow-up like "also add his sister" is contract-classified the same whether or not the
        # preceding turn actually established who "his" is.
        figures = {**FIGURES}
        self.assertEqual(task_contract("Und seine Schwester?", figures), task_contract("Und seine Schwester?", figures))


class AssistantRuntimeCompleteTests(unittest.TestCase):
    def _runtime(self):
        runtime = AssistantRuntime.__new__(AssistantRuntime)
        runtime.url = "http://mock"
        return runtime

    def test_happy_path_returns_the_model_reply_with_sources_resolved(self):
        # Simple facts bypass the planner and need a single answer call.
        runtime = self._runtime()
        reply = {"message": "Alles bereit.", "citations": [], "proposals": []}
        with patch("backend.assistant.runtime.count_tokens", return_value=0), \
             patch("backend.assistant.runtime.invoke_chat", return_value=reply) as invoke:
            result = runtime.complete("Wie geht es Tarek?", {}, FIGURES, history=None)
        self.assertEqual(result["message"], "Alles bereit.")
        self.assertEqual(result["proposals"], [])
        self.assertEqual(invoke.call_count, 1)

    def test_complex_planner_gets_a_deterministic_search_seed_when_model_returns_none(self):
        runtime = self._runtime()
        planner_reply = {"goal": "audit", "steps": [], "searchQueries": [], "requiredKinds": []}
        with patch("backend.assistant.runtime.invoke_chat", return_value=planner_reply):
            plan = runtime._plan("Prüfe Manuskript und Timeline auf Konsistenz.", [])
        self.assertEqual(plan["searchQueries"], ["Prüfe Manuskript und Timeline auf Konsistenz."])

    def test_deterministic_fallback_avoids_repair_when_a_required_proposal_is_unambiguous(self):
        runtime = self._runtime()
        empty = {"message": "...", "citations": [], "proposals": []}
        with patch("backend.assistant.runtime.count_tokens", return_value=0), \
             patch("backend.assistant.runtime.invoke_chat", return_value=empty) as invoke:
            result = runtime.complete("Lege Igor als neue Figur an.", {}, FIGURES, history=None)
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual([item["kind"] for item in result["proposals"]], ["create_element"])
        self.assertEqual(result["proposals"][0]["element"]["name"], "Igor")
        steps = [item["step"] for item in result["agentTrace"]]
        self.assertIn("deterministic_fallback", steps)

    def test_board_arrangement_has_a_deterministic_fallback(self):
        runtime = self._runtime()
        proposal = runtime._forced_proposal("Sortiere das Figurenboard in einem Raster neu.", "[]", FIGURES)
        self.assertEqual(proposal, {"kind": "arrange_elements", "strategy": "grid"})

    def test_explicitly_picked_chapters_are_forced_into_context_even_when_retrieval_would_miss_them(self):
        # Plan B.4: an author-picked chapter range should always reach the model, not depend
        # on retrieve()'s lexical scoring guessing the question is about that chapter.
        runtime = self._runtime()
        manuscript = {"chapters": [{"id": "c1", "title": "Weit weg", "body": "Ganz andere Worte, die nichts mit der Frage zu tun haben.", "note": ""}]}
        reply = {"message": "ok", "citations": [], "proposals": []}
        with patch("backend.assistant.runtime.count_tokens", return_value=0), \
             patch("backend.assistant.runtime.invoke_chat", return_value=reply) as invoke:
            runtime.complete("Fasse das bitte allgemein zusammen.", manuscript, FIGURES, history=None, chapter_ids=["c1"])
        sent_content = invoke.call_args[0][1]["messages"][-1]["content"]
        self.assertIn("Ganz andere Worte", sent_content)

    def test_chapter_ids_that_match_nothing_do_not_break_a_normal_request(self):
        runtime = self._runtime()
        reply = {"message": "ok", "citations": [], "proposals": []}
        with patch("backend.assistant.runtime.count_tokens", return_value=0), \
             patch("backend.assistant.runtime.invoke_chat", return_value=reply):
            result = runtime.complete("Wie geht es Tarek?", {}, FIGURES, history=None, chapter_ids=["does-not-exist"])
        self.assertEqual(result["message"], "ok")

    def test_conversation_history_is_folded_into_the_first_payload(self):
        runtime = self._runtime()
        history = [{"role": "user", "content": "Wer ist Tarek?"}, {"role": "assistant", "content": "Ein Ritter."}]
        reply = {"message": "ok", "citations": [], "proposals": []}
        with patch("backend.assistant.runtime.count_tokens", return_value=1), \
             patch("backend.assistant.runtime.invoke_chat", return_value=reply) as invoke:
            runtime.complete("Und seine Familie?", {}, FIGURES, history=history)
        sent_messages = invoke.call_args[0][1]["messages"]
        roles_and_content = [(item["role"], item["content"]) for item in sent_messages if item["role"] in {"user", "assistant"}][:2]
        self.assertEqual(roles_and_content, [("user", "Wer ist Tarek?"), ("assistant", "Ein Ritter.")])


if __name__ == "__main__":
    unittest.main()
