from __future__ import annotations

import unittest

from quiltor.modules.assistant.tool_loop import (
    EXPECTED_READ_TOOL_NAMES,
    MAX_CALLS_PER_ROUND,
    MAX_TOOL_CALLS,
    MAX_TOOL_RESULT_CHARS,
    MAX_TOOL_RESULT_TOKENS,
    MAX_TOOL_ROUNDS,
    run_tool_loop,
)


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
    def _run(self, replies, *, execute=None, count_tokens=None, tool_catalog=None):
        calls = []
        replies = list(replies)
        read_tools = FakeReadTools(tool_catalog=tool_catalog, execute=execute)

        def invoke(request, prompt_tokens):
            calls.append((request, prompt_tokens))
            if not replies:
                raise AssertionError("unexpected model step")
            return replies.pop(0)

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
        tool_branch = schema["oneOf"][0]
        call_schemas = tool_branch["properties"]["toolCalls"]["items"]["oneOf"]
        names = {item["properties"]["name"]["const"] for item in call_schemas}
        self.assertEqual(names, set(EXPECTED_READ_TOOL_NAMES))
        self.assertEqual(
            tool_branch["properties"]["toolCalls"]["maxItems"],
            MAX_CALLS_PER_ROUND,
        )
        self.assertFalse(any(word in names for word in ("apply", "delete", "write")))
        self.assertEqual(result.final["message"], "done")

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
        self.assertEqual(result.final["message"], "resolved")
        second_messages = calls[1][0]["messages"]
        self.assertIn("untrusted story data", second_messages[-1]["content"])
        self.assertIn('"resolvedId":"tarek"', second_messages[-1]["content"])
        self.assertEqual([item["step"] for item in result.trace], ["read_tool", "tool_loop"])
        self.assertEqual(result.trace[0]["status"], "accepted")

    def test_unknown_or_write_tool_is_rejected_without_execution(self):
        executed = []
        result, _calls, _read_tools = self._run(
            [call_step("write_world")],
            execute=lambda requested: executed.append(requested) or (),
        )

        self.assertEqual(executed, [])
        self.assertEqual(result.failure, "invalid_tool_calls")
        self.assertIsNone(result.final)

    def test_more_than_six_calls_in_one_step_is_rejected(self):
        result, _calls, _read_tools = self._run([call_step(count=MAX_CALLS_PER_ROUND + 1)])

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
        self.assertEqual(result.failure, "tool_round_limit")
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
        step = {**final_step(), "toolCalls": []}
        result, _calls, _read_tools = self._run([step])

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
        final_schema = schema["oneOf"][1]["properties"]["final"]
        self.assertEqual(
            final_schema["required"],
            ["message", "citations", "proposals"],
        )


if __name__ == "__main__":
    unittest.main()
