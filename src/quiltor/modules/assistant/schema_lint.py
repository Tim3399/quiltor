"""Lint for the JSON schemas the assistant sends to an inference server (``lac-schema-v1``).

The local-ai-contract allows a narrow subset of JSON Schema in ``response_format``: the
intersection of what OpenAI's strict mode accepts and what llama.cpp turns into a grammar.
llama.cpp skips anything else silently, so a schema outside the subset is not refused, it is
simply enforced only in part. This lint refuses it before it is ever sent.

It runs when ``json_schema_format`` builds a request, so a schema that breaks a rule is a
programming error the suite catches, never a runtime error an author sees.

Known gap: the contract also wants every property listed in ``required`` (optionality only as
a union with ``null``). The assistant schemas have optional properties, and turning them into
required nullable ones changes what the model has to write. That rule is not enforced here
yet (decision D-187); T-265 does that rebuild. See ``NOT_ENFORCED``.
"""

from __future__ import annotations

from typing import Any

ALLOWED = frozenset(
    {
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
        "anyOf",
        "minItems",
        "maxItems",
        "pattern",
        "minimum",
        "maximum",
    }
)

# Rules of lac-schema-v1 this lint deliberately leaves out, with the reason.
NOT_ENFORCED = {
    "every property in required": (
        "the assistant schemas have optional properties; required nullable ones follow in T-265"
    ),
}

MAX_DEPTH = 10


class SchemaLintError(ValueError):
    """A schema that would be sent to a server breaks lac-schema-v1."""


def lint(schema: Any) -> list[str]:
    """Return every rule ``schema`` breaks, as ``"<where>: <rule>"``; empty means clean."""

    problems: list[str] = []
    if not isinstance(schema, dict) or schema.get("type") != "object":
        problems.append("#: the root must be type object")
    if isinstance(schema, dict) and "anyOf" in schema:
        problems.append("#: anyOf is not allowed at the root")
    _lint(schema, "#", 1, problems)
    return problems


def assert_clean(schema: Any, name: str = "schema") -> None:
    problems = lint(schema)
    if problems:
        raise SchemaLintError(f"{name} breaks lac-schema-v1: " + "; ".join(problems))


def _lint(schema: Any, where: str, depth: int, out: list[str]) -> None:
    if depth > MAX_DEPTH:
        out.append(f"{where}: nested deeper than {MAX_DEPTH} levels")
        return
    if not isinstance(schema, dict):
        out.append(f"{where}: a schema must be an object")
        return
    for keyword in sorted(set(schema) - ALLOWED):
        out.append(f"{where}: keyword {keyword!r} is not allowed")
    if "anyOf" in schema and "properties" in schema:
        out.append(f"{where}: anyOf next to properties is not allowed")
    if "properties" in schema or schema.get("type") == "object":
        if schema.get("additionalProperties") is not False:
            out.append(f"{where}: an object needs additionalProperties false")
        properties = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in properties:
                out.append(f"{where}: required {name!r} is not a property")
    if "pattern" in schema:
        pattern = schema["pattern"]
        if not (isinstance(pattern, str) and pattern.startswith("^") and pattern.endswith("$")):
            out.append(f"{where}: pattern must have the form ^...$")
    if ("minimum" in schema or "maximum" in schema) and schema.get("type") != "integer":
        out.append(f"{where}: minimum and maximum only on integer")
    for name, child in (schema.get("properties") or {}).items():
        _lint(child, f"{where}/properties/{name}", depth + 1, out)
    if "items" in schema:
        _lint(schema["items"], f"{where}/items", depth + 1, out)
    if "anyOf" in schema:
        _lint_any_of(schema["anyOf"], where, depth, out)


def _lint_any_of(branches: Any, where: str, depth: int, out: list[str]) -> None:
    """Each branch is an object with a required single-value enum, and the values differ.

    That discriminator is what keeps anyOf ("at least one branch") as strict as the oneOf
    ("exactly one branch") it replaced: no value can match two branches.
    """

    if not isinstance(branches, list) or not branches:
        out.append(f"{where}: anyOf must be a non-empty list")
        return
    seen: dict[tuple[str, str], int] = {}
    for index, branch in enumerate(branches):
        at = f"{where}/anyOf/{index}"
        _lint(branch, at, depth + 1, out)
        tags = _discriminators(branch)
        if not tags:
            out.append(f"{at}: an anyOf branch needs a required single-value enum property")
        for tag in tags:
            if tag in seen:
                out.append(f"{at}: discriminator {tag[0]}={tag[1]!r} repeats branch {seen[tag]}")
            seen.setdefault(tag, index)


def _discriminators(branch: Any) -> list[tuple[str, str]]:
    if not isinstance(branch, dict):
        return []
    properties = branch.get("properties") or {}
    tags = []
    for name in branch.get("required") or []:
        enum = (properties.get(name) or {}).get("enum")
        if isinstance(enum, list) and len(enum) == 1 and isinstance(enum[0], str):
            tags.append((name, enum[0]))
    return tags
