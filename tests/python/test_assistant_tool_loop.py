from __future__ import annotations

import unittest

from quiltor.modules.assistant.ports import InferenceValidationError
from quiltor.modules.assistant.tool_loop import (
    EXPECTED_READ_TOOL_NAMES,
    INVALID_STEP_NOTE,
    MAX_CALLS_PER_ROUND,
    MAX_TOOL_CALLS,
    MAX_TOOL_RESULT_CHARS,
    MAX_TOOL_RESULT_TOKENS,
    MAX_TOOL_ROUNDS,
    run_tool_loop,
)
from tests.python.narrowing import present


def catalog():
    arguments = {
        "type": "object",
        "required": [],
        "additionalProperties": False,
        "properties": {},
    }
    return tuple(
        {
            "name": name,
            "description": f"Read through {name}.",
            "inputSchema": arguments,
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {"maxItems": 8},
        }
        for name in EXPECTED_READ_TOOL_NAMES
    )


def payload():
    return {
        "model": "local",
        "stream": False,
        "temperature": 0.2,
        "max_tokens": 900,
        "messages": [
            {"role": "system", "content": "System."},
            {"role": "user", "content": "Question."},
        ],
    }


def final_step(message="done"):
    return {
        "action": "final",
        "final": {"message": message, "citations": [], "proposals": []},
    }


def call_step(name="resolve_entity", arguments=None, count=1):
    return {
        "action": "tool_calls",
        "toolCalls": [
            {"name": name, "arguments": dict(arguments or {})} for _index in range(count)
        ],
    }


def envelope(name="resolve_entity", result=None, *, revision=3, ok=True):
    return {
        "name": name,
        "ok": ok,
        "readOnly": True,
        "sideEffectFree": True,
        "worldRevision": revision,
        **({"result": result or {"status": "not_found"}} if ok else {"error": "invalid"}),
    }


def not_found(name="resolve_entity", *, revision=3, code="not_found"):
    """The read tools' own failure envelope (read_tools._error)."""
    return {
        "name": name,
        "ok": False,
        "readOnly": True,
        "sideEffectFree": True,
        "worldRevision": revision,
        "error": {"code": code, "message": "The requested exact reference was not found."},
    }


class FakeReadTools:
    def __init__(self, *, tool_catalog=None, execute=None):
        self._catalog = tuple(tool_catalog or catalog())
        self._execute = execute or (
            lambda requested: tuple(envelope(call["name"]) for call in requested)
        )
        self.executions = []

    def catalog(self):
        return self._catalog

    def execute_many(self, calls, *, manuscript, figures, world_revision):
        self.executions.append(
            {
                "calls": calls,
                "manuscript": manuscript,
                "figures": figures,
                "worldRevision": world_revision,
            }
        )
        return self._execute(calls)


class AssistantToolLoopTests(unittest.TestCase):
    def _run(self, replies, *, execute=None, count_tokens=None, tool_catalog=None, respond=None):
        calls = []
        replies = list(replies)
        read_tools = FakeReadTools(tool_catalog=tool_catalog, execute=execute)

        def invoke(request, prompt_tokens):
            calls.append((request, prompt_tokens))
            if respond is not None:
                return {"step": respond(request)}
            if not replies:
                raise AssertionError("unexpected model step")
            reply = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return {"step": reply}

        result = run_tool_loop(
            payload(),
            allowed_proposal_kinds=("create_element",),
            read_tools=read_tools,
            invoke=invoke,
            count_tokens=count_tokens or (lambda text: len(text.split())),
            world_revision=3,
            manuscript={"chapters": []},
            figures={"nodes": []},
        )
        return result, calls, read_tools

    def test_step_schema_exposes_only_the_six_read_only_tools(self):
        result, calls, _read_tools = self._run([final_step()])

        schema = calls[0][0]["response_format"]["json_schema"]["schema"]
        tool_branch = schema["properties"]["step"]["anyOf"][0]
        call_schemas = tool_branch["properties"]["toolCalls"]["items"]["anyOf"]
        names = {item["properties"]["name"]["enum"][0] for item in call_schemas}
        self.assertEqual(names, set(EXPECTED_READ_TOOL_NAMES))
        self.assertEqual(
            tool_branch["properties"]["toolCalls"]["maxItems"],
            MAX_CALLS_PER_ROUND,
        )
        self.assertFalse(any(word in names for word in ("apply", "delete", "write")))
        self.assertEqual(present(result.final)["message"], "done")

    def test_read_results_are_bounded_untrusted_context_before_final(self):
        executed = []

        def execute(requested):
            executed.append(requested)
            return (envelope(result={"resolvedId": "tarek"}),)

        result, calls, read_tools = self._run(
            [call_step(arguments={"mention": "Tarek"}), final_step("resolved")],
            execute=execute,
        )

        self.assertEqual(len(executed), 1)
        self.assertEqual(read_tools.executions[0]["worldRevision"], 3)
        self.assertEqual(result.tool_rounds, 1)
        self.assertEqual(result.tool_calls, 1)
        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "resolved")
        second_messages = calls[1][0]["messages"]
        self.assertIn("untrusted story data", second_messages[-1]["content"])
        self.assertIn('"resolvedId":"tarek"', second_messages[-1]["content"])
        self.assertEqual([item["step"] for item in result.trace], ["read_tool", "tool_loop"])
        self.assertEqual(result.trace[0]["status"], "accepted")

    def test_unknown_or_write_tool_is_rejected_without_execution(self):
        # Since D-219 (T-307) an invalid step gets a hint and then a final-only call; only a
        # third invalid step ends the loop. Nothing is executed on the way.
        executed = []
        result, calls, _read_tools = self._run(
            [call_step("write_world")] * 3,
            execute=lambda requested: executed.append(requested) or (),
        )

        self.assertEqual(len(calls), 3)
        self.assertEqual(executed, [])
        self.assertEqual(result.failure, "invalid_tool_calls")
        self.assertIsNone(result.final)

    def test_more_than_six_calls_in_one_step_is_rejected(self):
        # Since D-219 (T-307) an invalid step gets a hint and then a final-only call; only a
        # third invalid step ends the loop. Nothing is executed on the way.
        result, _calls, _read_tools = self._run([call_step(count=MAX_CALLS_PER_ROUND + 1)] * 3)

        self.assertEqual(result.failure, "invalid_tool_calls")
        self.assertEqual(result.tool_calls, 0)

    def test_global_call_budget_is_enforced_before_next_execution(self):
        executions = []

        def execute(requested):
            executions.append(len(requested))
            return tuple(envelope(call["name"]) for call in requested)

        result, _calls, _read_tools = self._run(
            [
                call_step(count=6),
                call_step(count=6),
                call_step(count=1),
            ],
            execute=execute,
        )

        self.assertEqual(MAX_TOOL_CALLS, 12)
        self.assertEqual(executions, [6, 6])
        self.assertEqual(result.failure, "tool_call_limit")
        self.assertEqual(result.tool_calls, 12)

    def test_calls_after_four_read_rounds_fail_closed(self):
        executions = []
        result, _calls, _read_tools = self._run(
            [call_step() for _index in range(MAX_TOOL_ROUNDS + 1)],
            execute=lambda requested: (
                executions.append(requested) or tuple(envelope(call["name"]) for call in requested)
            ),
        )

        self.assertEqual(len(executions), MAX_TOOL_ROUNDS)
        # After round four only a final step is allowed (T-307); a fifth tool step is invalid.
        self.assertEqual(result.failure, "invalid_tool_calls")
        self.assertEqual(result.tool_rounds, MAX_TOOL_ROUNDS)
        self.assertIsNone(result.final)

    def test_rejected_dispatch_result_fails_closed(self):
        result, _calls, _read_tools = self._run(
            [call_step()],
            execute=lambda _requested: (envelope(ok=False),),
        )

        self.assertEqual(result.failure, "tool_execution_rejected")
        self.assertEqual(result.tool_rounds, 1)
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.trace[0]["status"], "rejected")

    def test_not_found_goes_back_to_the_model_and_the_loop_completes(self):
        # An empty world: the model looks up an id that does not exist (T-61 WebLLM run).
        def execute(requested):
            return tuple(not_found(call["name"]) for call in requested)

        result, calls, _read_tools = self._run(
            [call_step("get_entity", {"elementId": "new:world"}), final_step("nobody yet")],
            execute=execute,
        )

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "nobody yet")
        returned = calls[1][0]["messages"][-1]["content"]
        # Only the code and the fixed short message reach the model: no paths, no traceback.
        self.assertIn(
            '{"name":"get_entity","ok":false,"readOnly":true,"sideEffectFree":true,'
            '"worldRevision":3,"error":{"code":"not_found",'
            '"message":"The requested exact reference was not found."}}',
            returned,
        )
        self.assertNotIn("Traceback", returned)
        self.assertEqual(result.trace[0]["status"], "error_returned")
        self.assertIs(result.trace[0]["ok"], False)

    def test_error_without_read_only_promise_still_fails_closed(self):
        result, _calls, _read_tools = self._run(
            [call_step(), final_step()],
            execute=lambda requested: tuple(
                {**not_found(call["name"]), "readOnly": False} for call in requested
            ),
        )

        self.assertEqual(result.failure, "tool_execution_rejected")
        self.assertEqual(result.trace[0]["status"], "rejected")

    def test_error_from_another_world_revision_still_fails_closed(self):
        result, _calls, _read_tools = self._run(
            [call_step(), final_step()],
            execute=lambda requested: tuple(
                not_found(call["name"], revision=4) for call in requested
            ),
        )

        self.assertEqual(result.failure, "tool_execution_rejected")

    def test_returned_errors_still_count_against_the_round_limit(self):
        result, _calls, _read_tools = self._run(
            [call_step() for _index in range(MAX_TOOL_ROUNDS + 1)],
            execute=lambda requested: tuple(not_found(call["name"]) for call in requested),
        )

        # After round four only a final step is allowed (T-307); a fifth tool step is invalid.
        self.assertEqual(result.failure, "invalid_tool_calls")
        self.assertEqual(result.tool_rounds, MAX_TOOL_ROUNDS)

    def test_budget_errors_are_not_returned_to_the_model(self):
        # result_too_large joined the returnable codes after D-218 (T-307); see the test below.
        for code in ("too_many_calls", "invalid_snapshot"):
            with self.subTest(code=code):
                result, _calls, _read_tools = self._run(
                    [call_step(), final_step()],
                    execute=lambda requested, code=code: tuple(
                        not_found(call["name"], code=code) for call in requested
                    ),
                )
                self.assertEqual(result.failure, "tool_execution_rejected")

    # --- T-307: the read budget ends in an answer, not in the fallback text ---------------

    def _final_only(self, request) -> bool:
        schema = request["response_format"]["json_schema"]["schema"]
        branches = schema["properties"]["step"]["anyOf"]
        return [branch["properties"]["action"]["enum"] for branch in branches] == [["final"]]

    def test_a_result_over_the_budget_goes_back_as_result_too_large(self):
        # A system prompt of ~6000 words leaves the round room for ~1000 words, not 4000.
        def execute(requested):
            return tuple(envelope(call["name"], {"text": "wort " * 4000}) for call in requested)

        result, calls, _read_tools = self._run(
            [call_step(), final_step("narrower")],
            execute=execute,
            count_tokens=lambda text: len(text.split()) + 6000 * ("System." in text),
        )

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "narrower")
        self.assertIn('"code":"result_too_large"', calls[1][0]["messages"][-1]["content"])
        self.assertEqual(result.trace[0]["status"], "error_returned")

    def test_no_room_for_another_round_asks_once_more_for_an_answer_only(self):
        def execute(requested):
            return tuple(envelope(call["name"], {"text": "wort " * 700}) for call in requested)

        result, calls, _read_tools = self._run(
            [call_step(), final_step("from what I have")],
            execute=execute,
            count_tokens=lambda text: len(text.split()) + 6000 * ("System." in text),
        )

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "from what I have")
        self.assertFalse(self._final_only(calls[0][0]))
        self.assertTrue(self._final_only(calls[1][0]))
        self.assertIn("READ BUDGET USED UP", calls[1][0]["messages"][-1]["content"])

    def test_after_the_last_round_the_model_may_only_answer(self):
        result, calls, _read_tools = self._run(
            [*(call_step() for _index in range(MAX_TOOL_ROUNDS)), final_step("four rounds")]
        )

        self.assertIsNone(result.failure)
        self.assertEqual(result.tool_rounds, MAX_TOOL_ROUNDS)
        self.assertEqual(len(calls), MAX_TOOL_ROUNDS + 1)
        self.assertTrue(self._final_only(calls[-1][0]))
        self.assertFalse(any(self._final_only(call[0]) for call in calls[:-1]))

    def test_four_rounds_of_a_thousand_tokens_end_in_an_answer(self):
        # The example world's first prompt on llama was 6333 tokens (T-307 confirmation).
        def execute(requested):
            return tuple(envelope(call["name"], {"text": "wort " * 1024}) for call in requested)

        # Like a real engine: a tool step while tools are offered, an answer once only final is.
        result, _calls, _read_tools = self._run(
            [],
            execute=execute,
            count_tokens=lambda text: len(text.split()) + 4500 * ("System." in text),
            respond=lambda request: (
                final_step("answered") if self._final_only(request) else call_step()
            ),
        )

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "answered")

    def test_a_long_step_message_counts_with_its_real_length(self):
        def execute(requested):
            return tuple(envelope(call["name"], {"text": "kurz"}) for call in requested)

        long_step = call_step(arguments={"mention": "wort " * 2500})
        result, calls, _read_tools = self._run(
            [long_step, final_step("short")],
            execute=execute,
            count_tokens=lambda text: len(text.split()) + 5000 * ("System." in text),
        )

        self.assertIsNone(result.failure)
        self.assertTrue(self._final_only(calls[1][0]))
        self.assertEqual(result.trace[0]["status"], "budget_exhausted")

    def test_the_adapters_own_result_too_large_goes_back_to_the_model(self):
        result, calls, _read_tools = self._run(
            [call_step(), final_step("smaller then")],
            execute=lambda requested: tuple(
                not_found(call["name"], code="result_too_large") for call in requested
            ),
        )

        self.assertIsNone(result.failure)
        self.assertIn('"code":"result_too_large"', calls[1][0]["messages"][-1]["content"])

    # --- D-219 addendum (T-307): an invalid step gets one second chance --------------------

    def test_an_invalid_step_gets_a_hint_and_the_next_valid_step_answers(self):
        schema_error = InferenceValidationError("schema: $.step anyOf")
        result, calls, _read_tools = self._run([schema_error, final_step("second try")])

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "second try")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0]["messages"][-1]["content"], INVALID_STEP_NOTE)
        self.assertFalse(self._final_only(calls[1][0]))
        self.assertIn({"step": "tool_step_invalid", "count": 1}, result.trace)

    def test_two_invalid_steps_lead_to_a_final_only_call(self):
        schema_error = InferenceValidationError("schema: $.step anyOf")
        result, calls, _read_tools = self._run(
            [schema_error, call_step("write_world"), final_step("answer only")]
        )

        self.assertIsNone(result.failure)
        self.assertEqual(present(result.final)["message"], "answer only")
        self.assertEqual(len(calls), 3)
        self.assertTrue(self._final_only(calls[2][0]))
        self.assertIn("READ BUDGET USED UP", calls[2][0]["messages"][-1]["content"])

    def test_the_hint_carries_a_code_and_a_fixed_message_only(self):
        schema_error = InferenceValidationError("schema: $.step.toolCalls[0].arguments maxItems")
        _result, calls, _read_tools = self._run([schema_error, final_step()])

        hint = calls[1][0]["messages"][-1]["content"]
        self.assertIn('"code":"invalid_step"', hint)
        for internal in ("$.", "maxItems", "anyOf", "Traceback", "schema:"):
            self.assertNotIn(internal, hint)

    def test_an_invalid_step_does_not_change_the_round_limit(self):
        result, calls, _read_tools = self._run(
            [
                call_step(count=MAX_CALLS_PER_ROUND + 1),
                *(call_step() for _index in range(MAX_TOOL_ROUNDS)),
                final_step("four rounds"),
            ]
        )

        self.assertIsNone(result.failure)
        self.assertEqual(result.tool_rounds, MAX_TOOL_ROUNDS)
        self.assertEqual(len(calls), MAX_TOOL_ROUNDS + 2)
        self.assertTrue(self._final_only(calls[-1][0]))

    def test_execution_error_is_counted_and_traced(self):
        def fail_execution(_requested):
            raise RuntimeError("adapter failed")

        result, _calls, _read_tools = self._run(
            [call_step()],
            execute=fail_execution,
        )

        self.assertEqual(result.failure, "tool_execution_error")
        self.assertEqual(result.tool_rounds, 1)
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.trace[0]["status"], "execution_error")

    def test_invalid_result_count_is_counted_and_traced(self):
        result, _calls, _read_tools = self._run(
            [call_step()],
            execute=lambda _requested: (),
        )

        self.assertEqual(result.failure, "invalid_tool_results")
        self.assertEqual(result.tool_rounds, 1)
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.trace[0]["status"], "invalid_results")

    def test_catalog_maximum_sized_result_fits_the_loop_budget(self):
        result, _calls, _read_tools = self._run(
            [call_step(), final_step()],
            execute=lambda _requested: (envelope(result={"text": "x" * 12_000}),),
            count_tokens=lambda text: max(1, len(text) // 4),
        )

        self.assertEqual(MAX_TOOL_RESULT_CHARS, 16_384)
        self.assertEqual(MAX_TOOL_RESULT_TOKENS, 4_096)
        self.assertIsNone(result.failure)
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.trace[0]["status"], "accepted")

    def test_total_tool_result_token_budget_is_enforced(self):
        result, _calls, _read_tools = self._run(
            [call_step()],
            execute=lambda _requested: (envelope(result={"text": "x" * 18_000}),),
            count_tokens=lambda text: max(1, len(text) // 4),
        )

        self.assertEqual(result.failure, "tool_result_limit")
        self.assertIsNone(result.final)
        self.assertEqual(result.tool_rounds, 1)
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.trace[0]["status"], "result_limit")

    def test_final_action_cannot_smuggle_tool_calls(self):
        # Since D-219 (T-307) an invalid step gets a hint and then a final-only call; only a
        # third invalid step ends the loop. Nothing is executed on the way.
        step = {**final_step(), "toolCalls": []}
        result, _calls, _read_tools = self._run([step] * 3)

        self.assertEqual(result.failure, "invalid_final_step")
        self.assertIsNone(result.final)

    def test_catalog_with_side_effectful_or_extra_tool_fails_before_model(self):
        unsafe = [*catalog(), {**catalog()[0], "name": "delete_world"}]
        result, calls, _read_tools = self._run([final_step()], tool_catalog=unsafe)

        self.assertEqual(calls, [])
        self.assertEqual(result.failure, "unsafe_tool_catalog")

    def test_read_only_tool_outside_the_exact_allowlist_is_rejected(self):
        unsafe = list(catalog())
        unsafe[0] = {**unsafe[0], "name": "read_file"}

        result, calls, read_tools = self._run([final_step()], tool_catalog=unsafe)

        self.assertEqual(calls, [])
        self.assertEqual(read_tools.executions, [])
        self.assertEqual(result.failure, "unsafe_tool_catalog")

    def test_catalog_growth_reduces_output_budget_to_real_headroom(self):
        result, calls, _read_tools = self._run(
            [final_step()],
            count_tokens=lambda _text: 7_500,
        )

        self.assertIsNone(result.failure)
        expected = 8_192 - 7_500 - 256
        self.assertEqual(calls[0][0]["max_tokens"], expected)
        self.assertLess(calls[0][0]["max_tokens"], payload()["max_tokens"])

    def test_catalog_growth_below_minimum_headroom_fails_before_model(self):
        result, calls, _read_tools = self._run(
            [final_step()],
            count_tokens=lambda _text: 7_700,
        )

        self.assertEqual(calls, [])
        self.assertEqual(result.failure, "tool_context_limit")

    def test_reply_schema_still_exists_as_the_final_step_payload(self):
        _result, calls, _read_tools = self._run([final_step()])

        schema = calls[0][0]["response_format"]["json_schema"]["schema"]
        final_schema = schema["properties"]["step"]["anyOf"][1]["properties"]["final"]
        self.assertEqual(
            final_schema["required"],
            ["message", "citations", "proposals"],
        )


if __name__ == "__main__":
    unittest.main()
