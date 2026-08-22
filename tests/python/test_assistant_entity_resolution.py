import copy
import unittest

from quiltor.modules.assistant.audit import validate_proposals
from quiltor.modules.assistant.contract import (
    creation_target_resolution,
    existing_creation_target,
    task_contract,
)
from quiltor.modules.assistant.proposals import forced_proposal
from quiltor.modules.assistant.references import resolve_reference


FIGURES = {
    "nodes": [
        {
            "id": "tarek",
            "name": "Tarek Venn",
            "type": "person",
            "aliases": [{"alias": "Der Falke", "source": "manual"}],
        },
        {
            "id": "mara",
            "name": "Mara Nox",
            "type": "person",
            "aliases": [{"alias": "Die Eule", "source": "manual"}],
        },
        {
            "id": "hafen",
            "name": "Alter Hafen",
            "type": "ort",
            "aliases": [{"alias": "Westkai", "source": "manual"}],
        },
    ],
    "edges": [],
    "timeline": [{"id": "trial", "title": "Der Prozess"}],
}


def colliding_figures():
    figures = copy.deepcopy(FIGURES)
    figures["nodes"].append(
        {
            "id": "falke",
            "name": "Der Falke",
            "type": "person",
            "aliases": [],
        }
    )
    return figures


class AssistantEntityResolutionTests(unittest.TestCase):
    def test_relationship_endpoints_resolve_stored_aliases_to_ids(self):
        raw = {
            "kind": "create_relationship",
            "relationship": {
                "from": "Der Falke",
                "to": "Die Eule",
                "label": "Verbündet",
                "directed": False,
                "style": "solid",
            },
        }
        result = validate_proposals(
            [raw], FIGURES, "Schlage eine Beziehung von Der Falke zu Die Eule vor."
        )
        self.assertEqual(result[0]["relationship"]["from"], "tarek")
        self.assertEqual(result[0]["relationship"]["to"], "mara")
        self.assertEqual(raw["relationship"]["from"], "Der Falke")

    def test_ambiguous_name_alias_collision_is_never_chosen_for_relationship(self):
        same_name = copy.deepcopy(FIGURES)
        same_name["nodes"].append({"id": "other-tarek", "name": "Tarek Venn", "type": "person"})
        for figures, endpoint in (
            (colliding_figures(), "Der Falke"),
            (same_name, "Tarek Venn"),
        ):
            with self.subTest(endpoint=endpoint):
                raw = {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": endpoint,
                        "to": "mara",
                        "label": "Verbündet",
                        "directed": False,
                        "style": "solid",
                    },
                }
                self.assertEqual(
                    validate_proposals([raw], figures, "Schlage eine Beziehung vor."),
                    [],
                )

    def test_create_validation_and_preflight_block_an_existing_alias(self):
        question = "Lege Der Falke als Figur an."
        raw = {
            "kind": "create_element",
            "tempId": "new:falke",
            "element": {"type": "person", "name": "Der Falke"},
        }
        contract = task_contract(question, FIGURES)
        self.assertEqual(validate_proposals([raw], FIGURES, question), [])
        self.assertEqual(existing_creation_target(question, FIGURES, contract)["id"], "tarek")

    def test_ambiguous_create_preflight_returns_all_candidates(self):
        figures = colliding_figures()
        question = "Lege Der Falke als Figur an."
        resolution = creation_target_resolution(question, figures, task_contract(question, figures))
        self.assertEqual(resolution.status, "ambiguous")
        self.assertEqual(
            {candidate.element_id for candidate in resolution.candidates}, {"tarek", "falke"}
        )

    def test_update_presence_and_death_accept_unique_aliases_only(self):
        proposals = [
            {
                "kind": "update_element",
                "elementId": "Der Falke",
                "patch": {"sub": "Vorsichtig"},
            },
            {
                "kind": "set_presence",
                "elementId": "Die Eule",
                "placeId": "Westkai",
                "momentId": "trial",
            },
            {
                "kind": "mark_deceased",
                "elementId": "Die Eule",
                "momentId": "trial",
            },
        ]
        questions = [
            "Aktualisiere das Profil von Der Falke.",
            "Setze die Anwesenheit von Die Eule am Westkai.",
            "Markiere Die Eule am Zeitpunkt trial als verstorben.",
        ]
        results = [
            validate_proposals([proposal], FIGURES, question)[0]
            for proposal, question in zip(proposals, questions)
        ]
        self.assertEqual(results[0]["elementId"], "tarek")
        self.assertEqual(results[1]["elementId"], "mara")
        self.assertEqual(results[1]["placeId"], "hafen")
        self.assertEqual(results[2]["elementId"], "mara")

    def test_deterministic_fallback_uses_aliases_but_refuses_ambiguity(self):
        update = forced_proposal(
            "Ergänze bei Der Falke im Profil die Notiz: Vorsichtig.", "[]", FIGURES
        )
        relationship = forced_proposal(
            "Schlage eine Beziehung von Der Falke zu Die Eule vor.", "[]", FIGURES
        )
        self.assertEqual(update["elementId"], "tarek")
        self.assertEqual(relationship["relationship"]["from"], "tarek")
        self.assertEqual(relationship["relationship"]["to"], "mara")
        self.assertIsNone(
            forced_proposal(
                "Ergänze bei Der Falke im Profil die Notiz: Vorsichtig.",
                "[]",
                colliding_figures(),
            )
        )

    def test_ambiguous_explicit_reference_uses_existing_clarification_shape(self):
        result = resolve_reference(
            "Ergänze bei Der Falke im Profil die Notiz: Vorsichtig.",
            [],
            colliding_figures(),
        )
        self.assertEqual(
            {item["id"] for item in result["clarification"]["candidates"]},
            {"tarek", "falke"},
        )

    def test_timeline_history_reference_stays_on_the_separate_exact_id_path(self):
        result = resolve_reference(
            "Ändere ihn.",
            [{"role": "assistant", "references": ["timeline:trial"]}],
            FIGURES,
        )
        self.assertEqual(result, {"resolvedId": "trial"})


if __name__ == "__main__":
    unittest.main()
