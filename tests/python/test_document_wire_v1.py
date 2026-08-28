import json
import unittest
from copy import deepcopy
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from quiltor.application import (
    InvalidDocumentWireV1,
    MAX_SAFE_REVISION,
    decode_document_v1,
    encode_document_v1,
)
from quiltor.delivery.http.routes import documents
from quiltor.domain.story_world.entity_resolution import (
    ENTITY_ALIAS_ASCII_UPPERCASE_V1,
    ENTITY_ALIAS_NORMALIZATION_V1,
    ENTITY_ALIAS_SEPARATOR_RANGES_V1,
    normalize_entity_name,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = REPO_ROOT / "contracts"


def registered_fixture(contract_name: str) -> dict:
    manifest = json.loads((CONTRACTS / "manifest.json").read_text(encoding="utf-8"))
    contract = next(
        item
        for item in manifest["contracts"]
        if item["name"] == contract_name and item["version"] == 1
    )
    fixture_path = CONTRACTS / contract["fixtures"][0]["path"]
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def registered_differential(contract_name: str) -> dict:
    manifest = json.loads((CONTRACTS / "manifest.json").read_text(encoding="utf-8"))
    contract = next(
        item
        for item in manifest["contracts"]
        if item["name"] == contract_name and item["version"] == 1
    )
    fixture = next(item for item in contract["fixtures"] if item["role"] == "differential")
    return json.loads((CONTRACTS / fixture["path"]).read_text(encoding="utf-8"))


def _materialize(value):
    if isinstance(value, dict) and value.get("$special") == "nan":
        return float("nan")
    if isinstance(value, dict) and value.get("$special") == "infinity":
        return float("inf")
    if isinstance(value, dict) and value.get("$special") == "astral":
        return "😀" * value.get("count", 0)
    return deepcopy(value)


def _segments(path: str) -> list[str]:
    return [part.replace("~1", "/").replace("~0", "~") for part in path[1:].split("/")]


def mutate(base, path: str, operation: str, value=None):
    candidate = deepcopy(base)
    parts = _segments(path)
    key = parts.pop()
    parent = candidate
    for part in parts:
        parent = parent[int(part)] if isinstance(parent, list) else parent[part]
    if operation == "remove":
        if isinstance(parent, list):
            del parent[int(key)]
        else:
            del parent[key]
    elif isinstance(parent, list):
        parent[int(key)] = _materialize(value)
    else:
        parent[key] = _materialize(value)
    return candidate


def at_pointer(value, path: str):
    current = value
    for part in _segments(path):
        current = current[int(part)] if isinstance(current, list) else current[part]
    return current


class DocumentWireV1Tests(unittest.TestCase):
    def test_frozen_alias_rules_and_vectors_match_the_registered_contract(self):
        rules = json.loads(
            (
                CONTRACTS / "application-api" / "story-world" / "alias-normalization.v1.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(rules["algorithm"], ENTITY_ALIAS_NORMALIZATION_V1)
        self.assertEqual(
            (
                rules["asciiUppercase"]["minimum"],
                rules["asciiUppercase"]["maximum"],
                rules["asciiUppercase"]["lowercaseOffset"],
            ),
            ENTITY_ALIAS_ASCII_UPPERCASE_V1,
        )
        self.assertEqual(
            tuple((item["minimum"], item["maximum"]) for item in rules["separatorRanges"]),
            ENTITY_ALIAS_SEPARATOR_RANGES_V1,
        )
        corpus = registered_differential("application.story-world-wire")
        self.assertEqual(corpus["normalizationAlgorithm"], ENTITY_ALIAS_NORMALIZATION_V1)
        for vector in corpus["normalization"]:
            self.assertEqual(
                normalize_entity_name(vector["input"]),
                vector["expected"],
                vector["id"],
            )

    def test_registered_differential_corpora_match_python_runtime(self):
        for kind, contract_name in (
            ("manuscript", "application.manuscript-wire"),
            ("figures", "application.story-world-wire"),
        ):
            corpus = registered_differential(contract_name)
            base = json.loads((CONTRACTS / corpus["baseFixture"]).read_text(encoding="utf-8"))
            with self.subTest(contract=contract_name):
                for presence in corpus["optionalPresence"]:
                    prepared = base
                    for path in presence.get("alsoRemove", []):
                        prepared = mutate(prepared, path, "remove")
                    absent = mutate(prepared, presence["path"], "remove")
                    explicit_null = mutate(prepared, presence["path"], "set", None)
                    decoded = decode_document_v1(kind, absent)
                    decode_document_v1(
                        kind,
                        encode_document_v1(kind, decoded.payload, decoded.revision),
                    )
                    with self.assertRaises(
                        InvalidDocumentWireV1, msg=f"{contract_name}:{presence['id']}:null"
                    ):
                        decode_document_v1(kind, explicit_null)

                for case in corpus["cases"]:
                    candidate = mutate(
                        base,
                        case["path"],
                        case["operation"],
                        case.get("value"),
                    )
                    if case["expect"] == "reject":
                        with self.assertRaises(
                            InvalidDocumentWireV1, msg=f"{contract_name}:{case['id']}"
                        ):
                            decode_document_v1(kind, candidate)
                        continue
                    decoded = decode_document_v1(kind, candidate)
                    canonical = encode_document_v1(kind, decoded.payload, decoded.revision)
                    decode_document_v1(kind, canonical)
                    if case.get("canonical") == "integer":
                        self.assertIs(
                            type(at_pointer(canonical, case["path"])),
                            int,
                            f"{contract_name}:{case['id']}",
                        )

    def test_every_optional_presence_case_is_enforced_at_http_save_and_read_boundaries(self):
        with patch("builtins.print"):
            for kind, contract_name in (
                ("manuscript", "application.manuscript-wire"),
                ("figures", "application.story-world-wire"),
            ):
                corpus = registered_differential(contract_name)
                base = json.loads((CONTRACTS / corpus["baseFixture"]).read_text(encoding="utf-8"))
                request = SimpleNamespace(
                    db_path="world.sqlite3",
                    world=SimpleNamespace(document_location="world-location"),
                )
                for presence in corpus["optionalPresence"]:
                    prepared = base
                    for path in presence.get("alsoRemove", []):
                        prepared = mutate(prepared, path, "remove")
                    absent = mutate(prepared, presence["path"], "remove")
                    explicit_null = mutate(prepared, presence["path"], "set", None)

                    accepted_operations = MagicMock()
                    accepted_operations.save.return_value = base["revision"] + 1
                    accepted_writer = SimpleNamespace(
                        headers={"If-Match": f'"{base["revision"]}"'},
                        _read_json_body=MagicMock(return_value=absent),
                        send_json=MagicMock(),
                    )
                    documents._write(
                        accepted_writer,
                        request,
                        SimpleNamespace(
                            lock=RLock(),
                            documents=accepted_operations,
                        ),
                        kind=kind,
                    )
                    self.assertTrue(
                        accepted_operations.save.called,
                        f"{contract_name}:{presence['id']}:absent",
                    )

                    rejected_operations = MagicMock()
                    rejected_writer = SimpleNamespace(
                        headers={"If-Match": f'"{base["revision"]}"'},
                        _read_json_body=MagicMock(return_value=explicit_null),
                        send_json=MagicMock(),
                        send_api_error=MagicMock(),
                    )
                    documents._write(
                        rejected_writer,
                        request,
                        SimpleNamespace(
                            lock=RLock(),
                            documents=rejected_operations,
                        ),
                        kind=kind,
                    )
                    rejected_writer.send_api_error.assert_called_once_with(
                        400, error_code="document.invalid_wire"
                    )
                    rejected_operations.save.assert_not_called()

                    if presence["path"] == "/revision":
                        continue
                    accepted_read_operations = MagicMock()
                    accepted_read_operations.load.return_value = SimpleNamespace(
                        state=absent["payload"], revision=base["revision"]
                    )
                    accepted_reader = SimpleNamespace(send_json=MagicMock())
                    documents._read(
                        accepted_reader,
                        request,
                        SimpleNamespace(
                            lock=RLock(),
                            documents=accepted_read_operations,
                        ),
                        kind=kind,
                    )
                    returned = accepted_reader.send_json.call_args.args[0]
                    decode_document_v1(kind, returned)

                    rejected_read_operations = MagicMock()
                    rejected_read_operations.load.return_value = SimpleNamespace(
                        state=explicit_null["payload"], revision=base["revision"]
                    )
                    rejected_reader = SimpleNamespace(
                        send_json=MagicMock(), send_api_error=MagicMock()
                    )
                    documents._read(
                        rejected_reader,
                        request,
                        SimpleNamespace(
                            lock=RLock(),
                            documents=rejected_read_operations,
                        ),
                        kind=kind,
                    )
                    rejected_reader.send_api_error.assert_called_once_with(
                        500,
                        error_code="document.invalid_persisted_state",
                        retryable=False,
                    )

    def test_utf16_differential_ranges_are_enforced_at_the_http_save_boundary(self):
        corpus = registered_differential("application.manuscript-wire")
        base = json.loads((CONTRACTS / corpus["baseFixture"]).read_text(encoding="utf-8"))
        cases = {case["id"]: case for case in corpus["cases"] if case["id"].startswith("utf16-")}
        request = SimpleNamespace(
            db_path="world.sqlite3",
            world=SimpleNamespace(document_location="world-location"),
        )
        with patch("builtins.print"):
            for case in cases.values():
                candidate = mutate(
                    base,
                    case["path"],
                    case["operation"],
                    case.get("value"),
                )
                operations = MagicMock()
                operations.save.return_value = base["revision"] + 1
                writer = SimpleNamespace(
                    headers={"If-Match": f'"{base["revision"]}"'},
                    _read_json_body=MagicMock(return_value=candidate),
                    send_json=MagicMock(),
                    send_api_error=MagicMock(),
                )
                documents._write(
                    writer,
                    request,
                    SimpleNamespace(lock=RLock(), documents=operations),
                    kind="manuscript",
                )
                if case["expect"] == "accept":
                    self.assertTrue(operations.save.called, case["id"])
                else:
                    operations.save.assert_not_called()
                    self.assertTrue(writer.send_api_error.called, case["id"])

    def test_registered_fixtures_round_trip_through_runtime_producer_and_consumer(self):
        for kind, contract_name in (
            ("manuscript", "application.manuscript-wire"),
            ("figures", "application.story-world-wire"),
        ):
            with self.subTest(kind=kind):
                fixture = registered_fixture(contract_name)
                decoded = decode_document_v1(kind, fixture)
                self.assertEqual(
                    encode_document_v1(kind, decoded.payload, decoded.revision), fixture
                )
                self.assertEqual(decoded.payload["extension"]["source"], "contract-fixture")

    def test_canonical_profile_fields_round_trip_with_extensions(self):
        fixture = registered_fixture("application.story-world-wire")
        profile = {
            "notizen": "Mara kennt das Archiv.",
            "noteReferences": [
                {
                    "id": "profile-reference-archive",
                    "target": {"kind": "place", "id": "archive"},
                    "from": 15,
                    "to": 21,
                    "surface": "Archiv",
                }
            ],
            "futureProfileField": {"kept": True},
            "fields": [
                {
                    "id": "profile-field-role",
                    "key": "Rolle",
                    "value": "Kartographin",
                    "futureFieldData": {"source": "import"},
                },
                {
                    "id": "profile-field-motive",
                    "key": "Motiv",
                    "value": "Wahrheit",
                },
            ],
        }
        fixture["payload"]["nodes"][0]["profile"] = deepcopy(profile)

        decoded = decode_document_v1("figures", fixture)
        self.assertEqual(decoded.payload["nodes"][0]["profile"], profile)
        encoded = encode_document_v1("figures", decoded.payload, decoded.revision)
        self.assertEqual(encoded["payload"]["nodes"][0]["profile"], profile)

        decoded.payload["nodes"][0]["profile"]["fields"][0]["futureFieldData"]["source"] = "changed"
        self.assertEqual(
            fixture["payload"]["nodes"][0]["profile"]["fields"][0]["futureFieldData"],
            {"source": "import"},
        )

    def test_legacy_profile_fields_normalize_deterministically_with_extensions(self):
        fixture = registered_fixture("application.story-world-wire")
        fixture["payload"]["nodes"][0]["profile"] = {
            "alter": "32",
            "rolle": "Kartographin",
            "aussehen": "Reisemantel",
            "herkunft": "Nordküste",
            "stimme": "ruhig",
            "notizen": "Mara kennt das Archiv.",
            "noteReferences": [
                {
                    "id": "profile-reference-archive",
                    "target": {"kind": "place", "id": "archive"},
                    "from": 15,
                    "to": 21,
                    "surface": "Archiv",
                }
            ],
            "extra": [
                {
                    "k": "Motiv",
                    "v": "Wahrheit",
                    "futureFieldData": {"source": "legacy-import"},
                }
            ],
            "futureProfileField": {"kept": True},
        }

        decoded = decode_document_v1("figures", fixture)
        profile = decoded.payload["nodes"][0]["profile"]
        self.assertEqual(
            profile,
            {
                "notizen": "Mara kennt das Archiv.",
                "noteReferences": [
                    {
                        "id": "profile-reference-archive",
                        "target": {"kind": "place", "id": "archive"},
                        "from": 15,
                        "to": 21,
                        "surface": "Archiv",
                    }
                ],
                "futureProfileField": {"kept": True},
                "fields": [
                    {
                        "id": "profile-field:mara:legacy:alter",
                        "key": "Alter",
                        "value": "32",
                    },
                    {
                        "id": "profile-field:mara:legacy:rolle",
                        "key": "Rolle in der Geschichte",
                        "value": "Kartographin",
                    },
                    {
                        "id": "profile-field:mara:legacy:aussehen",
                        "key": "Aussehen",
                        "value": "Reisemantel",
                    },
                    {
                        "id": "profile-field:mara:legacy:herkunft",
                        "key": "Herkunft & Vorgeschichte",
                        "value": "Nordküste",
                    },
                    {
                        "id": "profile-field:mara:legacy:stimme",
                        "key": "Stimme & Sprechweise",
                        "value": "ruhig",
                    },
                    {
                        "futureFieldData": {"source": "legacy-import"},
                        "id": "profile-field:mara:extra:0",
                        "key": "Motiv",
                        "value": "Wahrheit",
                    },
                ],
            },
        )
        self.assertNotIn("alter", profile)
        self.assertNotIn("extra", profile)
        self.assertEqual(
            encode_document_v1("figures", decoded.payload, decoded.revision)["payload"]["nodes"][0][
                "profile"
            ],
            profile,
        )
        self.assertIn("alter", fixture["payload"]["nodes"][0]["profile"])

    def test_profile_field_ids_keys_and_values_are_strict(self):
        invalid_fields = (
            [
                {"id": "duplicate", "key": "Rolle", "value": "Zeugin"},
                {"id": "duplicate", "key": "Motiv", "value": "Wahrheit"},
            ],
            [{"id": "", "key": "Rolle", "value": "Zeugin"}],
            [{"id": 7, "key": "Rolle", "value": "Zeugin"}],
            [{"id": "field-role", "key": 7, "value": "Zeugin"}],
            [{"id": "field-role", "key": "Rolle", "value": None}],
        )
        for fields in invalid_fields:
            candidate = registered_fixture("application.story-world-wire")
            candidate["payload"]["nodes"][0]["profile"] = {
                "notizen": "",
                "fields": fields,
            }
            with self.subTest(fields=fields), self.assertRaises(InvalidDocumentWireV1):
                decode_document_v1("figures", candidate)

        for invalid_extra in (None, [{"k": None, "v": "invalid"}]):
            invalid_legacy_extra = registered_fixture("application.story-world-wire")
            invalid_legacy_extra["payload"]["nodes"][0]["profile"]["extra"] = invalid_extra
            with self.subTest(extra=invalid_extra), self.assertRaises(InvalidDocumentWireV1):
                decode_document_v1("figures", invalid_legacy_extra)

        canonical_with_valid_legacy_extra = registered_fixture("application.story-world-wire")
        canonical_with_valid_legacy_extra["payload"]["nodes"][0]["profile"]["extra"] = [
            {"k": "Ignored legacy", "v": "Canonical fields stay authoritative"}
        ]
        decoded = decode_document_v1("figures", canonical_with_valid_legacy_extra)
        self.assertNotIn("extra", decoded.payload["nodes"][0]["profile"])

    def test_legacy_profile_fields_support_long_owner_ids(self):
        fixture = registered_fixture("application.story-world-wire")
        owner_id = "owner" * 120
        fixture["payload"]["nodes"][0]["id"] = owner_id
        fixture["payload"]["edges"][0]["from"] = owner_id
        fixture["payload"]["edges"][0]["versions"][0]["from"] = owner_id
        fixture["payload"]["presence"][0]["elementId"] = owner_id
        profile = fixture["payload"]["nodes"][0]["profile"]
        del profile["fields"]
        profile["alter"] = "32"

        decoded = decode_document_v1("figures", fixture)
        expected_id = f"profile-field:{owner_id}:legacy:alter"
        self.assertEqual(decoded.payload["nodes"][0]["profile"]["fields"][0]["id"], expected_id)
        encoded = encode_document_v1("figures", decoded.payload, decoded.revision)
        self.assertEqual(encoded["payload"]["nodes"][0]["profile"]["fields"][0]["id"], expected_id)

    def test_envelope_is_strict_and_versioned(self):
        fixture = registered_fixture("application.manuscript-wire")
        malformed = []
        for key, value in (
            ("contract", "quiltor.story-world"),
            ("version", 2),
            ("revision", True),
        ):
            candidate = deepcopy(fixture)
            candidate[key] = value
            malformed.append(candidate)
        extra = deepcopy(fixture)
        extra["worldId"] = "routing-does-not-belong-here"
        malformed.append(extra)
        missing = deepcopy(fixture)
        del missing["payload"]
        malformed.append(missing)

        for candidate in malformed:
            with self.subTest(candidate=candidate):
                with self.assertRaises(InvalidDocumentWireV1):
                    decode_document_v1("manuscript", candidate)

    def test_revision_matches_the_javascript_safe_integer_range(self):
        fixture = registered_fixture("application.manuscript-wire")
        fixture["revision"] = MAX_SAFE_REVISION
        self.assertEqual(decode_document_v1("manuscript", fixture).revision, MAX_SAFE_REVISION)

        for revision in (-1, MAX_SAFE_REVISION + 1, float("inf")):
            candidate = deepcopy(fixture)
            candidate["revision"] = revision
            with self.subTest(revision=revision):
                with self.assertRaises(InvalidDocumentWireV1):
                    decode_document_v1("manuscript", candidate)

        for contract in ("manuscript", "story-world"):
            schema = json.loads(
                (CONTRACTS / "application-api" / contract / "v1.schema.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                schema["properties"]["revision"],
                {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": MAX_SAFE_REVISION,
                },
            )

    def test_every_published_document_integer_has_explicit_safe_bounds(self):
        def integer_nodes(value, path="$"):
            if not isinstance(value, dict):
                return
            if value.get("type") == "integer":
                yield path, value
            for key, child in value.items():
                if isinstance(child, dict):
                    yield from integer_nodes(child, f"{path}/{key}")
                elif isinstance(child, list):
                    for index, item in enumerate(child):
                        yield from integer_nodes(item, f"{path}/{key}/{index}")

        for contract in ("manuscript", "story-world"):
            schema = json.loads(
                (CONTRACTS / "application-api" / contract / "v1.schema.json").read_text(
                    encoding="utf-8"
                )
            )
            for path, node in integer_nodes(schema):
                with self.subTest(contract=contract, path=path):
                    self.assertIn("minimum", node)
                    self.assertIn("maximum", node)
                    self.assertGreaterEqual(node["minimum"], -MAX_SAFE_REVISION)
                    self.assertLessEqual(node["maximum"], MAX_SAFE_REVISION)

    def test_malformed_payload_is_rejected_before_persistence(self):
        fixture = registered_fixture("application.story-world-wire")
        fixture["payload"]["nodes"][0]["x"] = "not-a-coordinate"
        with self.assertRaises(InvalidDocumentWireV1):
            decode_document_v1("figures", fixture)

        non_finite = registered_fixture("application.story-world-wire")
        non_finite["payload"]["nodes"][0]["x"] = float("nan")
        with self.assertRaises(InvalidDocumentWireV1):
            decode_document_v1("figures", non_finite)

        malformed_edges = []
        wrong_directed = registered_fixture("application.story-world-wire")
        wrong_directed["payload"]["edges"][0]["gerichtet"] = "yes"
        malformed_edges.append(wrong_directed)
        wrong_active = registered_fixture("application.story-world-wire")
        wrong_active["payload"]["edges"][0]["active"] = "yes"
        malformed_edges.append(wrong_active)
        wrong_version_style = registered_fixture("application.story-world-wire")
        wrong_version_style["payload"]["edges"][0]["versions"][0]["style"] = "wavy"
        malformed_edges.append(wrong_version_style)

        for candidate in malformed_edges:
            with self.subTest(edge=candidate["payload"]["edges"][0]):
                with self.assertRaises(InvalidDocumentWireV1):
                    decode_document_v1("figures", candidate)

    def test_http_route_rejects_invalid_edges_and_unsafe_revision_headers_before_save(self):
        fixture = registered_fixture("application.story-world-wire")
        malformed = []
        for target, key, value in (
            (fixture["payload"]["edges"][0], "gerichtet", "yes"),
            (fixture["payload"]["edges"][0], "active", "yes"),
            (fixture["payload"]["edges"][0]["versions"][0], "style", "wavy"),
        ):
            candidate = deepcopy(fixture)
            if target is fixture["payload"]["edges"][0]:
                candidate["payload"]["edges"][0][key] = value
            else:
                candidate["payload"]["edges"][0]["versions"][0][key] = value
            malformed.append(candidate)

        operations = MagicMock()
        app = SimpleNamespace(lock=RLock(), documents=operations)
        request = SimpleNamespace(
            db_path="world.sqlite3",
            world=SimpleNamespace(document_location="world-location"),
        )
        for candidate in malformed:
            writer = SimpleNamespace(
                headers={"If-Match": '"4"'},
                _read_json_body=MagicMock(return_value=candidate),
                send_json=MagicMock(),
                send_api_error=MagicMock(),
            )
            documents._write(writer, request, app, kind="figures")
            writer.send_api_error.assert_called_once_with(400, error_code="document.invalid_wire")

        for revision in (str(MAX_SAFE_REVISION + 1), "Infinity"):
            writer = SimpleNamespace(
                headers={"If-Match": f'"{revision}"'},
                _read_json_body=MagicMock(return_value=deepcopy(fixture)),
                send_json=MagicMock(),
                send_api_error=MagicMock(),
            )
            documents._write(writer, request, app, kind="figures")
            writer.send_api_error.assert_called_once_with(
                400, error_code="document.invalid_revision"
            )
        operations.save.assert_not_called()

    def test_http_route_produces_and_consumes_the_registered_envelope(self):
        fixture = registered_fixture("application.manuscript-wire")
        operations = MagicMock()
        operations.load.return_value = SimpleNamespace(
            state=deepcopy(fixture["payload"]), revision=fixture["revision"]
        )
        operations.save.return_value = fixture["revision"] + 1
        app = SimpleNamespace(lock=RLock(), documents=operations)
        request = SimpleNamespace(
            db_path="world.sqlite3",
            world=SimpleNamespace(document_location="world-location"),
        )
        reader = SimpleNamespace(send_json=MagicMock())

        documents._read(reader, request, app, kind="manuscript")

        reader.send_json.assert_called_once_with(
            fixture, headers={"ETag": f'"{fixture["revision"]}"'}
        )

        writer = SimpleNamespace(
            headers={"If-Match": f'"{fixture["revision"]}"'},
            _read_json_body=MagicMock(return_value=deepcopy(fixture)),
            send_json=MagicMock(),
        )
        documents._write(writer, request, app, kind="manuscript")

        operations.save.assert_called_once_with(
            "manuscript",
            fixture["payload"],
            fixture["revision"],
            "world-location",
        )
        writer.send_json.assert_called_once()


if __name__ == "__main__":
    unittest.main()
