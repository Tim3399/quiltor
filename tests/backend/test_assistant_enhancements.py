import unittest
from unittest.mock import patch

from backend.assistant.audit import validate_proposals
from backend.assistant.context import TokenCountCache, pack_chunks
from backend.assistant.references import resolve_reference
from backend.assistant.contract import existing_creation_target, task_contract
from backend.assistant.schemas import reply_schema
from backend.assistant.batch import _group_chapters_by_budget, _merge_accumulated
from backend.core.knowledge import KnowledgeChunk


class AssistantEnhancementTests(unittest.TestCase):
    def test_reply_schema_is_a_strict_discriminated_contract_union(self):
        schema = reply_schema(["set_presence"])
        proposal = schema["properties"]["proposals"]["items"]["oneOf"][0]
        self.assertEqual(proposal["properties"]["kind"], {"const": "set_presence"})
        self.assertFalse(proposal["additionalProperties"])

    def test_presence_requires_existing_element_place_and_optional_moment(self):
        figures = {
            "nodes": [{"id": "mara", "type": "person"}, {"id": "hafen", "type": "ort"}],
            "timeline": [{"id": "arrival"}],
        }
        valid = {
            "kind": "set_presence",
            "elementId": "mara",
            "placeId": "hafen",
            "momentId": "arrival",
        }
        invalid = {"kind": "set_presence", "elementId": "mara", "placeId": "mara"}
        self.assertEqual(
            validate_proposals([valid], figures, "Setze Maras Anwesenheit am Hafen."), [valid]
        )
        self.assertEqual(validate_proposals([invalid], figures, "Setze Maras Anwesenheit."), [])

    def test_reference_resolution_clarifies_multiple_last_turn_references(self):
        figures = {"nodes": [{"id": "mara", "name": "Mara"}, {"id": "tarek", "name": "Tarek"}]}
        history = [
            {
                "role": "assistant",
                "content": "Beide.",
                "references": ["element:mara", "element:tarek"],
            }
        ]
        result = resolve_reference("Ändere ihr Profil.", history, figures)
        self.assertEqual(
            {item["id"] for item in result["clarification"]["candidates"]}, {"mara", "tarek"}
        )

    def test_two_explicit_relationship_endpoints_do_not_trigger_pronoun_clarification(self):
        figures = {
            "nodes": [
                {"id": "elian", "name": "Priorin Elian"},
                {"id": "seal", "name": "Staatssiegel"},
            ]
        }
        self.assertIsNone(
            resolve_reference(
                "Schlage eine Beziehung von Priorin Elian zum Staatssiegel vor: Sie besitzt es.",
                [],
                figures,
            )
        )

    def test_existing_relationship_endpoint_is_not_mistaken_for_new_named_target(self):
        figures = {
            "nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}],
            "edges": [],
            "timeline": [],
        }
        question = "Lege Lio Venn als Figur an. Lio ist der Sohn von Tarek Venn."
        self.assertIsNone(
            existing_creation_target(question, figures, task_contract(question, figures))
        )

    def test_oversized_chunk_is_excerpted_instead_of_dropped(self):
        chunk = KnowledgeChunk(
            "chapter:c1:0", "chapter", "Eins", "abcdefghij", {"workspace": "text", "id": "c1"}
        )
        packed = pack_chunks([chunk], "tokenizer-a", 5, lambda _url, text: len(text))
        self.assertEqual(len(packed), 1)
        self.assertLess(len(packed[0].text), len(chunk.text) + 2)

    def test_token_cache_invalidates_on_tokenizer_identity_change(self):
        cache = TokenCountCache(1024)
        self.assertEqual(cache.count("a", "hello", lambda _: 2), 2)
        self.assertEqual(cache.count("a", "hello", lambda _: 9), 2)
        self.assertEqual(cache.count("b", "hello", lambda _: 9), 9)

    def test_oversized_batch_chapter_is_isolated_and_later_chapters_continue(self):
        chapters = [{"id": "huge", "body": "x" * 5000}, {"id": "small", "body": "x" * 10}]
        with patch(
            "backend.assistant.batch.count_tokens", side_effect=lambda _url, text: len(text)
        ):
            self.assertEqual(
                _group_chapters_by_budget(chapters, "mock", 100), [["huge"], ["small"]]
            )

    def test_batch_merge_preserves_temp_references_for_presence(self):
        figures = {"nodes": [], "edges": [], "timeline": []}
        accumulated = [
            {
                "kind": "create_element",
                "tempId": "new:place",
                "element": {"type": "ort", "name": "Archiv"},
            }
        ]
        merged = _merge_accumulated(figures, accumulated)
        self.assertEqual(merged["nodes"][0]["id"], "new:place")


if __name__ == "__main__":
    unittest.main()
