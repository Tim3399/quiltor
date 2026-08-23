import copy
import unittest

from quiltor.application.story_world import StoryWorldUseCases
from quiltor.domain.story_world import (
    ResolutionProof,
    StaleResolutionProof,
    build_resolution_context,
    ensure_alias,
    ensure_element,
    ensure_presence,
    ensure_relationship,
    ensure_timeline_moment,
    require_current_world_revision,
)


def _world():
    return {
        "nodes": [
            {
                "id": "ada",
                "name": "Ada Stern",
                "type": "person",
                "aliases": [{"alias": "Die Kartografin", "source": "manual"}],
            },
            {"id": "ben", "name": "Ben", "type": "person", "aliases": []},
            {
                "id": "harbor",
                "name": "Nordhafen",
                "type": "ort",
                "aliases": [{"alias": "Westkai", "source": "manual"}],
            },
            {"id": "cove", "name": "Smaragdbucht", "type": "ort", "aliases": []},
        ],
        "edges": [
            {
                "id": "ada-ben",
                "from": "ada",
                "to": "ben",
                "label": "Freunde",
                "style": "solid",
                "gerichtet": False,
            }
        ],
        "timeline": [
            {
                "id": "departure",
                "title": "Die Abreise",
                "date": "1421-03",
                "note": "Am Morgen",
            }
        ],
        "presence": [
            {
                "id": "ada-at-departure",
                "elementId": "ada",
                "placeId": "harbor",
                "momentId": "departure",
            }
        ],
    }


class ResolutionContextTests(unittest.TestCase):
    def test_context_is_a_copy_and_folds_raw_staged_proposal_wrappers(self):
        world = _world()
        context = build_resolution_context(
            world,
            7,
            staged_elements=[
                {
                    "kind": "create_element",
                    "tempId": "new:elian",
                    "element": {"name": "Elian", "type": "person"},
                }
            ],
            staged_moments=[
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:arrival",
                    "moment": {"title": "Ankunft", "date": "1421-04"},
                }
            ],
        )
        world["nodes"][0]["name"] = "Mutiert"
        self.assertEqual(context.story_world["nodes"][0]["name"], "Ada Stern")
        self.assertEqual(context.story_world["nodes"][-1]["id"], "new:elian")
        self.assertEqual(context.story_world["timeline"][-1]["id"], "new:arrival")

    def test_relationship_and_presence_without_model_ids_receive_stable_internal_ids(self):
        relationship = {
            "kind": "create_relationship",
            "relationship": {
                "from": "ada",
                "to": "harbor",
                "label": "lebt in",
                "directed": True,
                "style": "solid",
            },
        }
        presence = {"kind": "set_presence", "elementId": "ben", "placeId": "harbor"}
        context = build_resolution_context(
            _world(),
            7,
            staged_relationships=[relationship, copy.deepcopy(relationship)],
            staged_presence=[presence, copy.deepcopy(presence)],
        )
        staged_edges = [
            edge
            for edge in context.story_world["edges"]
            if edge["id"].startswith("staged:relationships:")
        ]
        staged_rows = [row for row in context.story_world["presence"] if row["elementId"] == "ben"]
        self.assertEqual(len(staged_edges), 1)
        self.assertEqual(len(staged_rows), 1)
        self.assertTrue(staged_edges[0]["id"].startswith("staged:relationships:"))
        self.assertTrue(staged_rows[0]["id"].startswith("staged:presence:"))

    def test_staged_objects_need_server_stable_identity_when_no_safe_key_exists(self):
        with self.assertRaisesRegex(ValueError, "stable id"):
            build_resolution_context(_world(), 7, staged_elements=[{"name": "Ohne Temp-ID"}])
        with self.assertRaisesRegex(ValueError, "stable id"):
            build_resolution_context(_world(), 7, staged_moments=[{"title": "Ohne Temp-ID"}])


class ElementEnsureTests(unittest.TestCase):
    def test_alias_resolves_existing_identity_and_patch_fields_become_update(self):
        context = build_resolution_context(_world(), 7)
        existing = ensure_element(context, {"name": "Die Kartografin", "type": "person"})
        update = ensure_element(
            context,
            {"name": "Die Kartografin", "type": "person", "label": "Navigatorin"},
        )
        self.assertEqual((existing.outcome, existing.resolved_id), ("existing", "ada"))
        self.assertTrue(existing.operation_satisfied)
        self.assertEqual(update.outcome, "update")
        self.assertFalse(update.operation_satisfied)
        self.assertEqual(update.canonical["name"], "Ada Stern")
        self.assertEqual(update.canonical["label"], "Navigatorin")

    def test_colliding_name_or_alias_is_never_silently_reused(self):
        world = _world()
        world["nodes"].append(
            {
                "id": "other-ada",
                "name": "Ada Stern",
                "type": "person",
                "aliases": [],
            }
        )
        decision = ensure_element(
            build_resolution_context(world, 7),
            {"name": "Ada Stern", "type": "person"},
        )
        self.assertEqual(decision.outcome, "ambiguous")
        self.assertEqual(decision.proof.status, "ambiguous")
        self.assertEqual(decision.proof.candidate_ids, ("ada", "other-ada"))

        alias_collision = _world()
        alias_collision["nodes"][1]["aliases"] = [{"alias": "Ada Stern", "source": "manual"}]
        decision = ensure_element(
            build_resolution_context(alias_collision, 7),
            {"name": "Ada Stern", "type": "person"},
        )
        self.assertEqual(decision.outcome, "ambiguous")
        self.assertEqual(decision.proof.candidate_ids, ("ada", "ben"))

    def test_already_staged_element_prevents_duplicate_create_in_same_response(self):
        context = build_resolution_context(
            _world(),
            7,
            staged_elements=[
                {
                    "kind": "create_element",
                    "tempId": "new:elian",
                    "element": {"name": "Elian", "type": "person"},
                }
            ],
        )
        decision = ensure_element(context, {"name": "Elian", "type": "person"})
        self.assertEqual((decision.outcome, decision.resolved_id), ("existing", "new:elian"))

    def test_invalid_candidate_returns_checked_invalid_decision_without_raising(self):
        decision = ensure_element(
            build_resolution_context(_world(), 7),
            {"name": "", "type": "unknown"},
        )
        self.assertEqual(decision.outcome, "invalid")
        self.assertTrue(decision.proof.checked)
        self.assertEqual(decision.proof.status, "invalid")

    def test_unhashable_model_values_abstain_as_invalid_instead_of_raising(self):
        context = build_resolution_context(_world(), 7)
        decisions = [
            ensure_element(context, {"name": "Neu", "type": {"forged": True}}),
            ensure_relationship(
                context,
                {"from": "ada", "to": "ben", "style": {"forged": True}},
            ),
            ensure_timeline_moment(
                context,
                {"title": "Neu", "precision": ["day"]},
            ),
            ensure_alias(
                context,
                {"elementId": "ada", "alias": "Neu", "source": ["manual"]},
            ),
        ]
        self.assertTrue(all(decision.outcome == "invalid" for decision in decisions))


class RelationshipEnsureTests(unittest.TestCase):
    def test_endpoints_are_canonicalized_and_undirected_identity_is_order_independent(self):
        context = build_resolution_context(_world(), 7)
        unchanged = ensure_relationship(
            context,
            {
                "from": "Ben",
                "to": "Die Kartografin",
                "label": "Freunde",
                "directed": False,
                "style": "solid",
            },
        )
        self.assertEqual((unchanged.outcome, unchanged.resolved_id), ("unchanged", "ada-ben"))
        self.assertEqual(unchanged.canonical["from"], "ben")
        self.assertEqual(unchanged.canonical["to"], "ada")
        self.assertNotIn("gerichtet", unchanged.canonical)

        update = ensure_relationship(
            context,
            {
                "from": "ada",
                "to": "ben",
                "label": "Rivalen",
                "directed": False,
                "style": "dashed",
            },
        )
        self.assertEqual(update.outcome, "update")
        self.assertFalse(update.operation_satisfied)

    def test_staged_relationship_is_idempotently_detected(self):
        candidate = {
            "from": "ada",
            "to": "harbor",
            "label": "lebt in",
            "directed": True,
            "style": "solid",
        }
        context = build_resolution_context(
            _world(),
            7,
            staged_relationships=[{"kind": "create_relationship", "relationship": candidate}],
        )
        decision = ensure_relationship(context, candidate)
        self.assertEqual(decision.outcome, "unchanged")
        self.assertTrue(decision.resolved_id.startswith("staged:relationships:"))

    def test_ambiguous_or_missing_endpoints_are_not_create_decisions(self):
        world = _world()
        world["nodes"].append({"id": "other-ben", "name": "Ben", "type": "person", "aliases": []})
        ambiguous = ensure_relationship(
            build_resolution_context(world, 7),
            {"from": "Ada Stern", "to": "Ben", "directed": True},
        )
        missing = ensure_relationship(
            build_resolution_context(_world(), 7),
            {"from": "Ada Stern", "to": "Unbekannt", "directed": True},
        )
        self.assertEqual(ambiguous.outcome, "ambiguous")
        self.assertEqual(missing.outcome, "invalid")


class TimelineMomentEnsureTests(unittest.TestCase):
    def test_existing_moment_is_noop_or_update_and_duplicate_identity_is_ambiguous(self):
        context = build_resolution_context(_world(), 7)
        unchanged = ensure_timeline_moment(
            context,
            {"title": "Die Abreise", "date": "1421-03"},
        )
        update = ensure_timeline_moment(
            context,
            {"title": "Die Abreise", "date": "1421-03", "note": "Bei Nacht"},
        )
        self.assertEqual(unchanged.outcome, "unchanged")
        self.assertEqual(update.outcome, "update")

        world = _world()
        world["timeline"].append(
            {"id": "other-departure", "title": "Die Abreise", "date": "1421-04"}
        )
        ambiguous = ensure_timeline_moment(
            build_resolution_context(world, 7),
            {"title": "Die Abreise"},
        )
        self.assertEqual(ambiguous.outcome, "ambiguous")
        self.assertEqual(
            ambiguous.proof.candidate_ids,
            ("departure", "other-departure"),
        )

    def test_staged_moment_prevents_duplicate_and_exact_id_can_be_checked(self):
        context = build_resolution_context(
            _world(),
            7,
            staged_moments=[
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:arrival",
                    "moment": {"title": "Ankunft", "date": "1421-04"},
                }
            ],
        )
        staged = ensure_timeline_moment(context, {"title": "Ankunft", "date": "1421-04"})
        exact = ensure_timeline_moment(context, {"id": "new:arrival"})
        self.assertEqual((staged.outcome, staged.resolved_id), ("unchanged", "new:arrival"))
        self.assertEqual((exact.outcome, exact.resolved_id), ("unchanged", "new:arrival"))


class PresenceEnsureTests(unittest.TestCase):
    def test_presence_resolves_aliases_and_distinguishes_noop_from_move(self):
        context = build_resolution_context(_world(), 7)
        unchanged = ensure_presence(
            context,
            {
                "elementId": "Die Kartografin",
                "placeId": "Westkai",
                "momentId": "departure",
            },
        )
        moved = ensure_presence(
            context,
            {
                "elementId": "Ada Stern",
                "placeId": "Smaragdbucht",
                "momentId": "departure",
            },
        )
        self.assertEqual(unchanged.outcome, "unchanged")
        self.assertEqual(moved.outcome, "update")
        self.assertEqual(moved.canonical["placeId"], "cove")

    def test_raw_staged_presence_is_detected_and_same_logical_key_replaces_it(self):
        first = {"kind": "set_presence", "elementId": "ben", "placeId": "harbor"}
        second = {"kind": "set_presence", "elementId": "ben", "placeId": "cove"}
        context = build_resolution_context(
            _world(),
            7,
            staged_presence=[first, second],
        )
        decision = ensure_presence(
            context,
            {"elementId": "ben", "placeId": "cove"},
        )
        self.assertEqual(decision.outcome, "unchanged")
        self.assertTrue(decision.resolved_id.startswith("staged:presence:"))

    def test_unknown_moment_or_non_place_never_creates_presence(self):
        context = build_resolution_context(_world(), 7)
        missing_moment = ensure_presence(
            context,
            {"elementId": "ada", "placeId": "harbor", "momentId": "missing"},
        )
        non_place = ensure_presence(
            context,
            {"elementId": "ada", "placeId": "ben"},
        )
        self.assertEqual(missing_moment.outcome, "invalid")
        self.assertEqual(non_place.outcome, "invalid")


class AliasEnsureTests(unittest.TestCase):
    def test_alias_create_noop_and_foreign_collision_are_explicit(self):
        context = build_resolution_context(_world(), 7)
        create = ensure_alias(
            context,
            {"elementId": "ada", "alias": "Sternsucherin", "source": "assistant"},
        )
        unchanged = ensure_alias(
            context,
            {"elementId": "ada", "alias": "Die Kartografin", "source": "manual"},
        )
        collision = ensure_alias(
            context,
            {"elementId": "ada", "alias": "Ben", "source": "assistant"},
        )
        self.assertEqual(create.outcome, "create")
        self.assertEqual(unchanged.outcome, "unchanged")
        self.assertTrue(unchanged.operation_satisfied)
        self.assertEqual((collision.outcome, collision.resolved_id), ("existing", "ben"))
        self.assertFalse(collision.operation_satisfied)


class ResolutionProofTests(unittest.TestCase):
    def test_proof_is_checked_revision_bound_and_not_reconstructable_from_model_data(self):
        decision = ensure_element(
            build_resolution_context(_world(), 7),
            {"name": "Neue Figur", "type": "person"},
        )
        self.assertTrue(decision.proof.checked)
        self.assertEqual(decision.proof.world_revision, 7)
        require_current_world_revision(decision.proof, 7)
        with self.assertRaises(StaleResolutionProof):
            require_current_world_revision(decision.proof, 8)
        with self.assertRaises(TypeError):
            require_current_world_revision(
                {
                    "checked": True,
                    "status": "not_found",
                    "worldRevision": 7,
                },
                7,
            )
        with self.assertRaises(TypeError):
            ResolutionProof(
                checked=True,
                status="not_found",
                mention="Neue Figur",
                candidate_ids=(),
                world_revision=7,
                _authority=object(),
            )

    def test_application_receipt_has_stable_transport_shape_but_no_apply_authority(self):
        receipt = StoryWorldUseCases.ensure_element(
            _world(),
            {"name": "Neue Figur", "type": "person"},
            world_revision=11,
        )
        self.assertEqual(
            receipt,
            {
                "operation": "element",
                "outcome": "create",
                "operationSatisfied": False,
                "resolvedId": None,
                "canonical": {"name": "Neue Figur", "type": "person"},
                "proof": {
                    "checked": True,
                    "status": "not_found",
                    "mention": "Neue Figur",
                    "candidateIds": [],
                    "worldRevision": 11,
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
