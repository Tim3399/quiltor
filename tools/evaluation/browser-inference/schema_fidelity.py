"""Measurement 1 of T-54: does XGrammar keep the assistant's real JSON schemas?

    py -3.12 -m venv .venv-fidelity
    .venv-fidelity/Scripts/python -m pip install --require-hashes -r \\
        tools/evaluation/browser-inference/requirements-fidelity.txt
    .venv-fidelity/Scripts/python tools/evaluation/browser-inference/schema_fidelity.py

Compiles each exported schema (`schemas/*.json`) with the XGrammar version that WebLLM bundles
(`versions.json`), then lets a `GrammarMatcher` accept hand-built instances token by token and
compares the verdict with `jsonschema`. No model runs: the matcher only needs a tokenizer.

Verdicts per case:
    kept             grammar and jsonschema agree
    wrongly rejected valid by jsonschema, refused by the grammar (a proposal kind becomes impossible)
    wrongly allowed  invalid by jsonschema, accepted by the grammar (costs a repair, nothing more)

Run it in its own venv, never in the project's.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import sys
import tempfile
import urllib.request
from contextlib import redirect_stderr
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jsonschema  # pyright: ignore[reportMissingModuleSource]
import xgrammar as xgr  # pyright: ignore[reportMissingImports]
from transformers import AutoTokenizer  # pyright: ignore[reportMissingImports]

HERE = Path(__file__).resolve().parent
SCHEMAS = HERE / "schemas"

# The tokenizer of the model in versions.json. Pinned by hash: a different file is a different
# measurement.
TOKENIZER_BASE = "https://huggingface.co/Qwen/Qwen3-4B/resolve/main/"
TOKENIZER_FILES = {
    "tokenizer.json": "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
}
# Padded vocabulary of Qwen3-4B (config.json `vocab_size`), what WebLLM passes as `fullVocabSize`.
VOCAB_SIZE = 151936
END_OF_TURN = "<|im_end|>"

Json = Any


def fetch_tokenizer(directory: Path) -> Path:
    """Download the pinned tokenizer files once and verify their hashes."""

    directory.mkdir(parents=True, exist_ok=True)
    for name, digest in TOKENIZER_FILES.items():
        target = directory / name
        if not target.exists():
            with urllib.request.urlopen(TOKENIZER_BASE + name, timeout=120) as response:
                target.write_bytes(response.read())
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != digest:
            raise SystemExit(f"{target}: sha256 {actual} does not match the pinned {digest}")
    config = directory / "tokenizer_config.json"
    if not config.exists():
        with urllib.request.urlopen(TOKENIZER_BASE + "tokenizer_config.json", timeout=120) as r:
            config.write_bytes(r.read())
    return directory


def minimal(schema: Json) -> Json:
    """Smallest instance of a schema, following the first branch of every `oneOf`."""

    if "oneOf" in schema:
        return minimal(schema["oneOf"][0])
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if kind == "object":
        props = schema.get("properties", {})
        return {key: minimal(props[key]) for key in schema.get("required", [])}
    if kind == "array":
        return [minimal(schema["items"]) for _ in range(schema.get("minItems", 0))]
    if kind == "string":
        if schema.get("pattern") == "^new:.*$":
            return "new:a"
        return "a" * schema.get("minLength", 0)
    if kind == "integer":
        return schema.get("minimum", 0)
    if kind == "boolean":
        return False
    if kind == "number":
        return schema.get("minimum", 0)
    raise ValueError(f"no minimal instance for {schema!r}")


@dataclass
class Case:
    schema: str
    feature: str
    title: str
    instance: Json


def reply_proposal(base: Json, index: int = 0) -> Json:
    return base["proposals"][index]


def build_cases(schemas: dict[str, Json]) -> list[Case]:
    cases: list[Case] = []

    def add(schema: str, feature: str, title: str, instance: Json) -> None:
        cases.append(Case(schema, feature, title, instance))

    # ---- reply_schema -------------------------------------------------------------------
    reply = schemas["reply_schema"]
    proposal_branches = reply["properties"]["proposals"]["items"]["oneOf"]
    kinds = [b["properties"]["kind"]["const"] for b in proposal_branches]
    base = minimal(reply)

    def with_proposal(proposal: Json) -> Json:
        return {"message": "ok", "citations": [], "proposals": [copy.deepcopy(proposal)]}

    add("reply_schema", "valid", "empty proposals", base)
    for branch, kind in zip(proposal_branches, kinds, strict=True):
        add("reply_schema", "valid", f"minimal {kind}", with_proposal(minimal(branch)))
    full_element = {
        "kind": "create_element",
        "tempId": "new:hanna",
        "element": {
            "name": "Hanna",
            "type": "person",
            "label": "Fischerin",
            "aliases": ["Hanne", "Fischer-Hanna"],
            "profile": {"alter": "34", "rolle": "Zeugin", "notes": "spricht leise"},
        },
    }
    add(
        "reply_schema",
        "valid",
        "create_element with every optional field",
        with_proposal(full_element),
    )
    add(
        "reply_schema",
        "valid",
        "message with umlauts, quotes and a newline",
        {
            "message": 'Hanna sagt: "Größe zählt"\nzweite Zeile',
            "citations": ["c1", "c2"],
            "proposals": [],
        },
    )
    twenty = {"message": "m", "citations": [], "proposals": [minimal(proposal_branches[5])] * 20}
    add("reply_schema", "valid", "proposals at maxItems 20", twenty)

    bad = copy.deepcopy(base)
    bad["proposals"] = [minimal(proposal_branches[0])] * 21
    add("reply_schema", "maxItems", "21 proposals", bad)
    bad = copy.deepcopy(base)
    bad["citations"] = ["x", "x"]
    add("reply_schema", "uniqueItems", "duplicate citations", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["aliases"] = ["Hanne", "Hanne"]
    add("reply_schema", "uniqueItems", "duplicate aliases", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["aliases"] = [f"a{i}" for i in range(17)]
    add("reply_schema", "maxItems", "17 aliases (limit 16)", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["aliases"] = [""]
    add("reply_schema", "minLength", "empty alias", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["name"] = "n" * 161
    add("reply_schema", "maxLength", "name with 161 characters", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["profile"]["notes"] = "n" * 1001
    add("reply_schema", "maxLength", "profile.notes with 1001 characters", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["tempId"] = "hanna"
    add("reply_schema", "pattern", "tempId without the new: prefix", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["kind"] = "delete_element"
    add("reply_schema", "const", "kind not in any branch", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["kind"] = "update_element"
    add("reply_schema", "const", "kind from another branch, fields of create_element", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["element"]["type"] = "gegenstand"
    add("reply_schema", "enum", "element.type outside the enum", bad)
    bad = with_proposal(full_element)
    bad["proposals"][0]["extra"] = 1
    add("reply_schema", "additionalProperties", "unknown key on a proposal", bad)
    bad = copy.deepcopy(base)
    bad["extra"] = True
    add("reply_schema", "additionalProperties", "unknown key on the root", bad)
    bad = with_proposal(full_element)
    del bad["proposals"][0]["element"]["name"]
    add("reply_schema", "required", "element without name", bad)
    bad = copy.deepcopy(base)
    del bad["citations"]
    add("reply_schema", "required", "reply without citations", bad)
    add("reply_schema", "oneOf", "proposal matching no branch", with_proposal({"foo": "bar"}))
    add("reply_schema", "type", "message is a number", {**base, "message": 3})

    # ---- reply_schema_no_proposals ------------------------------------------------------
    npr = schemas["reply_schema_no_proposals"]
    base = minimal(npr)
    add("reply_schema_no_proposals", "valid", "minimal", base)
    add("reply_schema_no_proposals", "valid", "with citations", {**base, "citations": ["a", "b"]})
    add("reply_schema_no_proposals", "valid", "long message", {**base, "message": "Satz. " * 200})
    add("reply_schema_no_proposals", "valid", "umlauts", {**base, "message": "Über Äpfel und Öl"})
    add("reply_schema_no_proposals", "valid", "empty message", {**base, "message": ""})
    add(
        "reply_schema_no_proposals",
        "key order",
        "valid, but message before citations (schema order is citations first)",
        {"message": "m", "citations": [], "proposals": []},
    )
    add(
        "reply_schema_no_proposals",
        "maxItems",
        "one proposal (limit 0)",
        {**base, "proposals": [{}]},
    )
    add(
        "reply_schema_no_proposals",
        "uniqueItems",
        "duplicate citations",
        {**base, "citations": ["a", "a"]},
    )
    add(
        "reply_schema_no_proposals",
        "required",
        "without proposals",
        {"message": "m", "citations": []},
    )
    add("reply_schema_no_proposals", "additionalProperties", "unknown key", {**base, "x": 1})
    add("reply_schema_no_proposals", "type", "citations is a string", {**base, "citations": "a"})

    # ---- planner_schema -----------------------------------------------------------------
    planner = schemas["planner_schema"]
    base = minimal(planner)
    kinds_enum = planner["properties"]["requiredKinds"]["items"]["enum"]
    add("planner_schema", "valid", "minimal", base)
    add(
        "planner_schema",
        "valid",
        "filled plan",
        {
            "goal": "Hanna anlegen",
            "steps": ["suchen", "anlegen"],
            "searchQueries": ["Hanna", "Hafen"],
            "requiredKinds": ["create_element", "set_presence"],
        },
    )
    add("planner_schema", "valid", "steps at maxItems 8", {**base, "steps": ["s"] * 8})
    add("planner_schema", "valid", "four search queries", {**base, "searchQueries": list("abcd")})
    add("planner_schema", "valid", "every kind", {**base, "requiredKinds": kinds_enum})
    add("planner_schema", "maxItems", "9 steps", {**base, "steps": ["s"] * 9})
    add("planner_schema", "maxItems", "5 search queries", {**base, "searchQueries": list("abcde")})
    add(
        "planner_schema",
        "maxLength",
        "query with 301 characters",
        {**base, "searchQueries": ["q" * 301]},
    )
    add("planner_schema", "uniqueItems", "duplicate query", {**base, "searchQueries": ["a", "a"]})
    add(
        "planner_schema",
        "uniqueItems",
        "duplicate kind",
        {**base, "requiredKinds": ["set_presence"] * 2},
    )
    add("planner_schema", "enum", "unknown kind", {**base, "requiredKinds": ["delete_all"]})
    add(
        "planner_schema", "required", "without goal", {k: v for k, v in base.items() if k != "goal"}
    )
    add("planner_schema", "additionalProperties", "unknown key", {**base, "x": 1})

    # ---- tool_step_schema ---------------------------------------------------------------
    step = schemas["tool_step_schema"]
    call_branches = step["oneOf"][0]["properties"]["toolCalls"]["items"]["oneOf"]
    names = [b["properties"]["name"]["const"] for b in call_branches]
    final = minimal(step["oneOf"][1])
    calls = minimal(step["oneOf"][0])
    calls_min = {"action": "tool_calls", "toolCalls": [minimal(call_branches[1])]}
    add("tool_step_schema", "valid", "minimal toolCalls (first branch)", calls)
    add("tool_step_schema", "valid", "minimal final", final)
    for branch, name in zip(call_branches, names, strict=True):
        add(
            "tool_step_schema",
            "valid",
            f"minimal call {name}",
            {"action": "tool_calls", "toolCalls": [minimal(branch)]},
        )
    add(
        "tool_step_schema",
        "valid",
        "six calls (maxItems)",
        {"action": "tool_calls", "toolCalls": [minimal(call_branches[1])] * 6},
    )
    add(
        "tool_step_schema",
        "valid",
        "final with a create_element proposal",
        {
            "action": "final",
            "final": {
                "message": "m",
                "citations": [],
                "proposals": [minimal(proposal_branches[0])],
            },
        },
    )
    add(
        "tool_step_schema",
        "valid",
        "get_relationships with limit 12",
        {
            "action": "tool_calls",
            "toolCalls": [
                {"name": "get_relationships", "arguments": {"elementId": "e1", "limit": 12}}
            ],
        },
    )
    add(
        "tool_step_schema", "minItems", "empty toolCalls", {"action": "tool_calls", "toolCalls": []}
    )
    add(
        "tool_step_schema",
        "maxItems",
        "seven calls",
        {"action": "tool_calls", "toolCalls": [minimal(call_branches[1])] * 7},
    )
    add(
        "tool_step_schema",
        "oneOf",
        "tool name outside every branch",
        {"action": "tool_calls", "toolCalls": [{"name": "delete_world", "arguments": {}}]},
    )
    add(
        "tool_step_schema",
        "oneOf",
        "known name, arguments of another tool",
        {
            "action": "tool_calls",
            "toolCalls": [{"name": "get_entity", "arguments": {"query": "x"}}],
        },
    )
    add(
        "tool_step_schema",
        "const",
        "action is neither tool_calls nor final",
        {**calls_min, "action": "stop"},
    )
    add(
        "tool_step_schema",
        "oneOf",
        "toolCalls together with final",
        {**calls_min, "final": final["final"]},
    )
    add(
        "tool_step_schema",
        "maximum",
        "limit 13 (maximum 12)",
        {
            "action": "tool_calls",
            "toolCalls": [
                {"name": "get_relationships", "arguments": {"elementId": "e1", "limit": 13}}
            ],
        },
    )
    add(
        "tool_step_schema",
        "minimum",
        "limit 0 (minimum 1)",
        {
            "action": "tool_calls",
            "toolCalls": [
                {"name": "get_relationships", "arguments": {"elementId": "e1", "limit": 0}}
            ],
        },
    )
    add(
        "tool_step_schema",
        "type",
        "limit 1.5 (integer)",
        {
            "action": "tool_calls",
            "toolCalls": [
                {"name": "get_relationships", "arguments": {"elementId": "e1", "limit": 1.5}}
            ],
        },
    )
    add(
        "tool_step_schema",
        "required",
        "get_entity without elementId",
        {"action": "tool_calls", "toolCalls": [{"name": "get_entity", "arguments": {}}]},
    )
    add(
        "tool_step_schema",
        "maxLength",
        "elementId with 201 characters",
        {
            "action": "tool_calls",
            "toolCalls": [{"name": "get_entity", "arguments": {"elementId": "e" * 201}}],
        },
    )
    add(
        "tool_step_schema",
        "minLength",
        "empty elementId",
        {
            "action": "tool_calls",
            "toolCalls": [{"name": "get_entity", "arguments": {"elementId": ""}}],
        },
    )
    add(
        "tool_step_schema",
        "additionalProperties",
        "unknown argument",
        {
            "action": "tool_calls",
            "toolCalls": [{"name": "get_entity", "arguments": {"elementId": "e1", "x": 1}}],
        },
    )
    add(
        "tool_step_schema",
        "valid",
        "resolve_entity with distinct contextIds",
        {
            "action": "tool_calls",
            "toolCalls": [
                {
                    "name": "resolve_entity",
                    "arguments": {"mention": "Hanna", "contextIds": ["a", "b"]},
                }
            ],
        },
    )
    add(
        "tool_step_schema",
        "uniqueItems",
        "duplicate contextIds",
        {
            "action": "tool_calls",
            "toolCalls": [
                {
                    "name": "resolve_entity",
                    "arguments": {"mention": "Hanna", "contextIds": ["a", "a"]},
                }
            ],
        },
    )
    bad = copy.deepcopy(final)
    bad["final"]["proposals"] = [
        {"kind": "create_element", "tempId": "x", "element": {"name": "n"}}
    ]
    add("tool_step_schema", "pattern", "final with tempId lacking new:", bad)
    bad = copy.deepcopy(final)
    bad["final"]["proposals"] = [minimal(proposal_branches[0])] * 21
    add("tool_step_schema", "maxItems", "final with 21 proposals", bad)
    return cases


def compile_grammar(
    compiler: xgr.GrammarCompiler, schema: Json
) -> tuple[xgr.CompiledGrammar | None, str, str]:
    """Compile like WebLLM does (`compileJSONSchema(schema)`, all defaults)."""

    captured = io.StringIO()
    try:
        with redirect_stderr(captured):
            compiled = compiler.compile_json_schema(
                json.dumps(schema), any_whitespace=True, indent=2, strict_mode=True
            )
    except (RuntimeError, ValueError, TypeError) as error:
        return None, f"{type(error).__name__}: {error}", captured.getvalue().strip()
    return compiled, "", captured.getvalue().strip()


def _branch_score(branch: Json, instance: Json) -> int:
    props = branch.get("properties", {})
    if not isinstance(instance, dict):
        return 0
    score = 0
    for key, value in instance.items():
        if key in props:
            score += 1
            if "const" in props[key] and props[key]["const"] == value:
                score += 10
    return score


def in_schema_order(instance: Json, schema: Json) -> Json:
    """Rewrite objects with their keys in the order the schema lists its properties.

    XGrammar emits properties in schema order and refuses any other order, while jsonschema does
    not care. Cases are fed in grammar order so that a rejection means a feature, not key order;
    the key-order behaviour itself has its own case.
    """

    if "oneOf" in schema:
        branch = max(schema["oneOf"], key=lambda b: _branch_score(b, instance))
        return in_schema_order(instance, branch)
    if isinstance(instance, dict):
        props = schema.get("properties", {})
        known = [key for key in props if key in instance]
        extra = [key for key in instance if key not in props]
        return {key: in_schema_order(instance[key], props.get(key, {})) for key in known + extra}
    if isinstance(instance, list) and "items" in schema:
        return [in_schema_order(item, schema["items"]) for item in instance]
    return instance


def accepts(compiled: xgr.CompiledGrammar, ids: list[int], stop_id: int) -> bool:
    """Feed the token ids and finish with the stop token; True when the matcher terminates."""

    matcher = xgr.GrammarMatcher(compiled, override_stop_tokens=[stop_id])
    for token in ids:
        if not matcher.accept_token(token):
            return False
    return bool(matcher.accept_token(stop_id)) and matcher.is_terminated()


def verdict(grammar_ok: bool, schema_ok: bool) -> str:
    if grammar_ok == schema_ok:
        return "kept"
    return "wrongly allowed" if grammar_ok else "wrongly rejected"


def run(tokenizer_dir: Path, out: Path | None, pretty: bool) -> int:
    versions = json.loads((HERE / "versions.json").read_text(encoding="utf-8"))
    installed = _installed_xgrammar()
    if installed != versions["xgrammar"]:
        raise SystemExit(
            f"xgrammar {installed} installed, versions.json pins {versions['xgrammar']}"
        )

    tokenizer = AutoTokenizer.from_pretrained(str(tokenizer_dir))
    info = xgr.TokenizerInfo.from_huggingface(tokenizer, vocab_size=VOCAB_SIZE)
    stop_id = tokenizer.convert_tokens_to_ids(END_OF_TURN)
    compiler = xgr.GrammarCompiler(info, cache_enabled=False)

    schemas = {
        p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(SCHEMAS.glob("*.json"))
    }
    validators = {
        name: jsonschema.Draft202012Validator(schema, format_checker=None)
        for name, schema in schemas.items()
    }
    compiled: dict[str, xgr.CompiledGrammar | None] = {}
    compile_report: dict[str, dict[str, str]] = {}
    for name, schema in schemas.items():
        grammar, error, warnings = compile_grammar(compiler, schema)
        compiled[name] = grammar
        compile_report[name] = {"error": error, "warnings": warnings}

    rows: list[dict[str, Any]] = []
    for case in build_cases(schemas):
        instance = case.instance
        if case.feature != "key order":
            instance = in_schema_order(instance, schemas[case.schema])
        text = json.dumps(
            instance,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        schema_ok = validators[case.schema].is_valid(instance)
        grammar = compiled[case.schema]
        if grammar is None:
            grammar_ok = False
        else:
            ids = tokenizer.encode(text, add_special_tokens=False)
            grammar_ok = accepts(grammar, ids, stop_id)
        rows.append(
            {
                "schema": case.schema,
                "feature": case.feature,
                "title": case.title,
                "jsonschema": schema_ok,
                "grammar": grammar_ok,
                "verdict": verdict(grammar_ok, schema_ok),
                "input": text if len(text) <= 160 else text[:157] + "...",
            }
        )

    report = {
        "xgrammar": installed,
        "tokenizer_sha256": TOKENIZER_FILES["tokenizer.json"],
        "compile": compile_report,
        "cases": rows,
    }
    if out is not None:
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print_report(report)
    return 0


def _installed_xgrammar() -> str:
    from importlib.metadata import version

    return version("xgrammar")


def print_report(report: dict[str, Any]) -> None:
    print(f"xgrammar {report['xgrammar']}")
    for name, info in report["compile"].items():
        status = info["error"] or "compiled"
        print(
            f"  compile {name}: {status}"
            + (f" | stderr: {info['warnings']}" if info["warnings"] else "")
        )
    print()
    totals: dict[str, dict[str, int]] = {}
    for row in report["cases"]:
        totals.setdefault(row["schema"], {}).setdefault(row["verdict"], 0)
        totals[row["schema"]][row["verdict"]] += 1
        flag = "" if row["verdict"] == "kept" else f"  <-- {row['verdict'].upper()}"
        print(
            f"{row['schema']:26} {row['feature']:20} jsonschema={int(row['jsonschema'])} "
            f"grammar={int(row['grammar'])} {row['title']}{flag}"
        )
    print()
    for name, counts in totals.items():
        print(f"{name}: {counts}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--tokenizer-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "quiltor-qwen3-tokenizer",
    )
    parser.add_argument("--out", type=Path, help="write the full report as JSON")
    parser.add_argument(
        "--pretty", action="store_true", help="feed indented JSON instead of compact"
    )
    args = parser.parse_args(argv)
    directory = fetch_tokenizer(args.tokenizer_dir)
    return run(directory, args.out, args.pretty)


if __name__ == "__main__":
    sys.exit(main())
