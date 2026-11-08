"""Dependency-free check of a model reply against the schema it was asked to follow.

Constrained decoding is a property of the engine, not of the contract: a provider in the
``json_object`` fallback, a relayed client engine or a sidecar may return anything. Every
reply is therefore checked here, against the original schema, before any hand-written
check behind it sees the data.

Exactly the keywords the assistant schemas use are understood. Any other keyword raises
:class:`UnsupportedSchemaKeyword`, so a schema that grows a new keyword fails loudly
instead of being checked only in part.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

KEYWORDS = frozenset(
    {
        "type",
        "properties",
        "required",
        "additionalProperties",
        "enum",
        "const",
        "pattern",
        "oneOf",
        "items",
        "minItems",
        "maxItems",
        "uniqueItems",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
    }
)

# The only patterns the assistant schemas contain. A new one must be added here on purpose,
# so that nobody hands an untrusted or catastrophic expression to `re` by accident.
PATTERNS: dict[str, re.Pattern[str]] = {source: re.compile(source) for source in ("^new:.*$",)}

MAX_DEPTH = 64

_TYPES = frozenset({"object", "array", "string", "integer", "number", "boolean", "null"})


class UnsupportedSchemaKeyword(ValueError):
    """The schema uses something this checker does not understand."""


@dataclass(frozen=True)
class Violation:
    path: str
    keyword: str

    def __str__(self) -> str:
        return f"{self.path} {self.keyword}"


def check(value: Any, schema: dict[str, Any]) -> list[Violation]:
    """Return every violation of ``schema`` by ``value``; an empty list means valid."""

    _check_schema(schema, "#", 0)
    violations: list[Violation] = []
    try:
        _check(value, schema, "$", 0, violations)
    except RecursionError:
        violations.append(Violation("$", "depth"))
    return violations


def _check_schema(schema: Any, where: str, depth: int) -> None:
    if depth > MAX_DEPTH:
        raise UnsupportedSchemaKeyword(f"{where}: schema nested deeper than {MAX_DEPTH}")
    if not isinstance(schema, dict):
        raise UnsupportedSchemaKeyword(f"{where}: a schema must be an object")
    unknown = sorted(set(schema) - KEYWORDS)
    if unknown:
        raise UnsupportedSchemaKeyword(f"{where}: unsupported keyword {unknown[0]!r}")
    if "type" in schema and schema["type"] not in _TYPES:
        raise UnsupportedSchemaKeyword(f"{where}: unsupported type {schema['type']!r}")
    if "additionalProperties" in schema and schema["additionalProperties"] is not False:
        raise UnsupportedSchemaKeyword(f"{where}: only additionalProperties false is supported")
    if "pattern" in schema and schema["pattern"] not in PATTERNS:
        raise UnsupportedSchemaKeyword(f"{where}: pattern {schema['pattern']!r} is not listed")
    for name, child in (schema.get("properties") or {}).items():
        _check_schema(child, f"{where}/properties/{name}", depth + 1)
    if "items" in schema:
        _check_schema(schema["items"], f"{where}/items", depth + 1)
    for index, branch in enumerate(schema.get("oneOf") or []):
        _check_schema(branch, f"{where}/oneOf/{index}", depth + 1)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _has_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    if isinstance(value, bool):
        return False
    if expected == "integer":
        return isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    return isinstance(value, (int, float))


def _check(value: Any, schema: dict[str, Any], path: str, depth: int, out: list[Violation]) -> None:
    if depth > MAX_DEPTH:
        out.append(Violation(path, "depth"))
        return
    if "type" in schema and not _has_type(value, schema["type"]):
        out.append(Violation(path, "type"))
        return
    if "const" in schema and _canonical(value) != _canonical(schema["const"]):
        out.append(Violation(path, "const"))
    if "enum" in schema and _canonical(value) not in {_canonical(v) for v in schema["enum"]}:
        out.append(Violation(path, "enum"))
    if "oneOf" in schema:
        matches = 0
        for branch in schema["oneOf"]:
            trial: list[Violation] = []
            _check(value, branch, path, depth + 1, trial)
            matches += not trial
        if matches != 1:
            out.append(Violation(path, "oneOf"))
    if isinstance(value, str):
        _check_string(value, schema, path, out)
    elif isinstance(value, list):
        _check_array(value, schema, path, depth, out)
    elif isinstance(value, dict):
        _check_object(value, schema, path, depth, out)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            out.append(Violation(path, "minimum"))
        if "maximum" in schema and value > schema["maximum"]:
            out.append(Violation(path, "maximum"))


def _check_string(value: str, schema: dict[str, Any], path: str, out: list[Violation]) -> None:
    if "minLength" in schema and len(value) < schema["minLength"]:
        out.append(Violation(path, "minLength"))
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        out.append(Violation(path, "maxLength"))
    if "pattern" in schema and PATTERNS[schema["pattern"]].search(value) is None:
        out.append(Violation(path, "pattern"))


def _check_array(
    value: list[Any], schema: dict[str, Any], path: str, depth: int, out: list[Violation]
) -> None:
    if "minItems" in schema and len(value) < schema["minItems"]:
        out.append(Violation(path, "minItems"))
    if "maxItems" in schema and len(value) > schema["maxItems"]:
        out.append(Violation(path, "maxItems"))
    if schema.get("uniqueItems") is True:
        seen = [_canonical(item) for item in value]
        if len(set(seen)) != len(seen):
            out.append(Violation(path, "uniqueItems"))
    if "items" in schema:
        for index, item in enumerate(value):
            _check(item, schema["items"], f"{path}[{index}]", depth + 1, out)


def _check_object(
    value: dict[str, Any], schema: dict[str, Any], path: str, depth: int, out: list[Violation]
) -> None:
    properties = schema.get("properties") or {}
    for name in schema.get("required") or []:
        if name not in value:
            out.append(Violation(f"{path}.{name}", "required"))
    for name, item in value.items():
        if name in properties:
            _check(item, properties[name], f"{path}.{name}", depth + 1, out)
        elif schema.get("additionalProperties") is False:
            out.append(Violation(f"{path}.{name}", "additionalProperties"))
