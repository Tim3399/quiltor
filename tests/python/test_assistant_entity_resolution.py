import copy
import unittest

from quiltor.modules.assistant.audit import validate_proposals
from quiltor.modules.assistant.contract import (
    creation_target_resolution,
    existing_creation_target,
    task_contract,
    verify_task_contract,
)
from quiltor.modules.assistant.proposal_resolution import resolve_proposals
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

    def test_resolve_before_create_reuses_an_existing_alias_with_server_proof(self):
        result = resolve_proposals(
            [
                {
                    "kind": "create_element",
                    "tempId": "new:falke",
                    "element": {
                        "type": "person",
                        "name": "Der Falke",
                        "proof": {"checked": True, "worldRevision": 999},
                    },
                    "resolution": {"outcome": "create"},
                }
            ],
            FIGURES,
            "Lege die neue Figur an.",
            world_revision=12,
        )

        self.assertEqual(result.proposals, [])
        self.assertEqual(result.satisfied_kinds, frozenset({"create_element"}))
        self.assertEqual(result.decisions[0].outcome, "existing")
        self.assertEqual(result.decisions[0].resolved_id, "tarek")
        self.assertEqual(result.decisions[0].proof.world_revision, 12)

    def test_resolve_before_create_returns_concrete_choice_for_collision(self):
        result = resolve_proposals(
            [
                {
                    "kind": "create_element",
                    "tempId": "new:falke",
                    "element": {"type": "person", "name": "Der Falke"},
                }
            ],
            colliding_figures(),
            "Lege die neue Figur an.",
            world_revision=3,
        )

        self.assertEqual(result.proposals, [])
        self.assertEqual(result.decisions[0].outcome, "ambiguous")
        self.assertEqual(
            {item["id"] for item in result.clarification["candidates"]},
            {"tarek", "falke"},
        )

    def test_resolve_before_create_deduplicates_one_model_response(self):
        proposals = [
            {
                "kind": "create_element",
                "tempId": f"new:nova:{index}",
                "element": {"type": "person", "name": "Nova"},
            }
            for index in range(2)
        ]

        result = resolve_proposals(
            proposals,
            FIGURES,
            "Lege neue Figuren an.",
            world_revision=4,
        )

        self.assertEqual(len(result.proposals), 1)
        self.assertEqual(result.proposals[0]["tempId"], "new:nova:0")
        self.assertEqual([item.outcome for item in result.decisions], ["create", "existing"])

    def test_relationship_and_presence_ensure_paths_do_not_duplicate(self):
        figures = copy.deepcopy(FIGURES)
        figures["edges"] = [
            {
                "id": "alliance",
                "from": "tarek",
                "to": "mara",
                "gerichtet": False,
                "label": "Verbündet",
                "style": "solid",
            }
        ]
        figures["presence"] = [
            {
                "id": "mara-at-port",
                "elementId": "mara",
                "placeId": "hafen",
                "momentId": "trial",
            }
        ]
        relationship = resolve_proposals(
            [
                {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": "Der Falke",
                        "to": "Die Eule",
                        "label": "Verbündet",
                        "directed": False,
                        "style": "solid",
                    },
                }
            ],
            figures,
            "Schlage eine Beziehung vor.",
            world_revision=5,
        )
        presence = resolve_proposals(
            [
                {
                    "kind": "set_presence",
                    "elementId": "Die Eule",
                    "placeId": "Westkai",
                    "momentId": "trial",
                }
            ],
            figures,
            "Setze die Anwesenheit der Figur am Ort.",
            world_revision=5,
        )

        self.assertEqual(relationship.proposals, [])
        self.assertEqual(relationship.decisions[0].outcome, "unchanged")
        self.assertEqual(presence.proposals, [])
        self.assertEqual(presence.decisions[0].outcome, "unchanged")

    def test_new_proposal_output_drops_model_supplied_resolution_metadata(self):
        result = resolve_proposals(
            [
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:moment:arrival",
                    "moment": {
                        "title": "Die Ankunft",
                        "proof": {"checked": True},
                        "resolvedId": "forged",
                    },
                    "proof": {"checked": True},
                }
            ],
            FIGURES,
            "Lege einen Zeitpunkt an.",
            world_revision=8,
        )

        self.assertEqual(
            result.proposals,
            [
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:moment:arrival",
                    "moment": {"title": "Die Ankunft"},
                }
            ],
        )

    def test_update_resolution_satisfies_create_contract_without_creating(self):
        question = "Lege die neue Figur an."
        result = resolve_proposals(
            [
                {
                    "kind": "create_element",
                    "tempId": "new:tarek",
                    "element": {
                        "type": "person",
                        "name": "Tarek Venn",
                        "label": "Hauptfigur",
                    },
                }
            ],
            FIGURES,
            question,
            world_revision=9,
        )

        self.assertEqual(result.decisions[0].outcome, "update")
        self.assertEqual([item["kind"] for item in result.proposals], ["update_element"])
        self.assertIn("create_element", result.satisfied_kinds)
        verification = verify_task_contract(
            task_contract(question, FIGURES),
            result.proposals,
            FIGURES,
            satisfied_kinds=result.satisfied_kinds,
        )
        self.assertTrue(verification["complete"])

    def test_ambiguous_relationship_without_stable_candidate_ids_stays_fail_closed(self):
        figures = copy.deepcopy(FIGURES)
        figures["edges"] = [
            {"from": "tarek", "to": "mara", "gerichtet": False},
            {"from": "mara", "to": "tarek", "gerichtet": False},
        ]
        result = resolve_proposals(
            [
                {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": "tarek",
                        "to": "mara",
                        "label": "",
                        "directed": False,
                        "style": "solid",
                    },
                }
            ],
            figures,
            "Schlage eine Beziehung vor.",
            world_revision=10,
        )

        self.assertEqual(result.proposals, [])
        self.assertEqual(result.decisions[0].outcome, "ambiguous")
        self.assertIsNotNone(result.clarification)
        self.assertEqual(result.clarification["candidates"], [])

    def test_relationship_reuses_existing_id_behind_model_temp_reference(self):
        result = resolve_proposals(
            [
                {
                    "kind": "create_element",
                    "tempId": "new:falke",
                    "element": {"type": "person", "name": "Der Falke"},
                },
                {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": "new:falke",
                        "to": "mara",
                        "label": "Sohn von",
                        "directed": True,
                        "style": "solid",
                    },
                },
            ],
            FIGURES,
            "Lege die Figur als Sohn von Mara an.",
            world_revision=11,
        )

        self.assertEqual([item["kind"] for item in result.proposals], ["create_relationship"])
        self.assertEqual(result.proposals[0]["relationship"]["from"], "tarek")
        self.assertIn("create_element", result.satisfied_kinds)
        self.assertIn("create_relationship", result.satisfied_kinds)

    def test_presence_reuses_existing_moment_id_behind_model_temp_reference(self):
        result = resolve_proposals(
            [
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:moment:trial",
                    "moment": {"title": "Der Prozess"},
                },
                {
                    "kind": "set_presence",
                    "elementId": "mara",
                    "placeId": "hafen",
                    "momentId": "new:moment:trial",
                },
            ],
            FIGURES,
            world_revision=12,
        )

        self.assertEqual([item["kind"] for item in result.proposals], ["set_presence"])
        self.assertEqual(result.proposals[0]["momentId"], "trial")
        self.assertEqual(
            [item.outcome for item in result.decisions],
            ["unchanged", "create"],
        )


if __name__ == "__main__":
    unittest.main()
