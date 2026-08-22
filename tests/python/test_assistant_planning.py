import unittest

from quiltor.modules.assistant import (
    AssistantRuntime,
    complete_compound_proposals,
    presence_consistency_issues,
    required_proposal_kinds,
    existing_creation_target,
    task_contract,
    validate_proposals,
    validate_world,
    verify_task_contract,
)


FIGURES = {
    "nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}],
    "edges": [],
    "timeline": [],
}


class AssistantPlanningTests(unittest.TestCase):
    def test_arrangement_rejects_unrelated_timeline_proposals(self):
        question = "Sortiere die Elemente thematisch neu."
        raw = [
            {
                "kind": "create_timeline_moment",
                "tempId": "new:moment:no",
                "moment": {"title": "Falsch"},
            }
        ]
        valid = validate_proposals(raw, FIGURES, question)
        self.assertEqual(required_proposal_kinds(question), {"arrange_elements"})
        self.assertEqual(
            complete_compound_proposals(question, valid, FIGURES),
            [{"kind": "arrange_elements", "strategy": "thematic"}],
        )

    def test_family_creation_is_completed_with_relationship_and_age(self):
        question = "Lege Igor an. Igor ist der Sohn von Tarek Venn und 4 Jahre alt."
        raw = [
            {
                "kind": "create_element",
                "tempId": "new:igor",
                "element": {"type": "person", "name": "Igor", "profile": "Kind"},
            }
        ]
        valid = validate_proposals(raw, FIGURES, question)
        completed = complete_compound_proposals(question, valid, FIGURES)
        self.assertEqual(
            {item["kind"] for item in completed}, {"create_element", "create_relationship"}
        )
        self.assertEqual(completed[0]["element"]["profile"]["alter"], "4")
        self.assertEqual(completed[1]["relationship"]["to"], "tarek")

    def test_owned_animal_is_an_atomic_compound_task(self):
        question = "Lege ein neues Tier an. Tarek Venn hat einen kleinen Corgi."
        raw = [
            {
                "kind": "create_element",
                "tempId": "new:corgi",
                "element": {"type": "tier", "name": "Corgi", "profile": {"notizen": "klein"}},
            }
        ]
        completed = complete_compound_proposals(
            question, validate_proposals(raw, FIGURES, question), FIGURES
        )
        self.assertEqual(
            required_proposal_kinds(question), {"create_element", "create_relationship"}
        )
        self.assertEqual(
            completed[1]["relationship"],
            {
                "from": "tarek",
                "to": "new:corgi",
                "label": "Besitzt",
                "directed": True,
                "style": "solid",
            },
        )
        verification = verify_task_contract(task_contract(question, FIGURES), completed, FIGURES)
        self.assertTrue(verification["complete"])

    def test_relationship_and_timeline_request_requires_both_operations(self):
        self.assertEqual(
            required_proposal_kinds("Lege passende Beziehungen an und ergänze ggf. die Timeline."),
            {"create_relationship", "create_timeline_moment"},
        )

    def test_existing_timeline_moment_is_not_proposed_twice(self):
        figures = {
            **FIGURES,
            "timeline": [{"id": "coronation", "title": "Die Krönung", "date": "1421-03-14"}],
        }
        raw = [
            {
                "kind": "create_timeline_moment",
                "tempId": "new:moment:coronation",
                "moment": {"title": "Die Krönung", "date": "1421-03-14"},
            }
        ]
        self.assertEqual(validate_proposals(raw, figures, "Lege einen Timeline-Zeitpunkt an."), [])

    def test_named_existing_animal_is_detected_before_model_call(self):
        figures = {
            "nodes": [
                {"id": "tarek", "name": "Tarek Venn", "type": "person"},
                {"id": "corgi", "name": "Corgi", "type": "tier"},
            ],
            "edges": [],
            "timeline": [],
        }
        question = "Lege ein Tier an. Tarek Venn hat einen kleinen Corgi."
        self.assertEqual(
            existing_creation_target(question, figures, task_contract(question, figures))["id"],
            "corgi",
        )

    def test_full_world_audit_counts_every_relationship_and_detects_bad_references(self):
        figures = {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "timeline": [{"id": "m1"}],
            "edges": [
                {
                    "id": "e1",
                    "from": "a",
                    "to": "b",
                    "gerichtet": True,
                    "versions": [{"momentId": "m1"}],
                },
                {
                    "id": "e2",
                    "from": "a",
                    "to": "missing",
                    "gerichtet": True,
                    "versions": [{"momentId": "missing"}],
                },
            ],
        }
        audit = validate_world(figures)
        self.assertEqual(audit["inspected"]["relationships"], 2)
        self.assertEqual(audit["inspected"]["relationshipStates"], 2)
        self.assertEqual(len(audit["issues"]), 2)

    def test_tool_intents_are_classified_without_planner_guessing(self):
        cases = {
            "Ergänze bei Tarek im Profil die Notiz: vorsichtig.": {"update_element"},
            "Ändere den Stand der Beziehung e1 am Zeitpunkt trial.": {"set_relationship_at_moment"},
            "Markiere Nima am Zeitpunkt trial als verstorben.": {"mark_deceased"},
            "Lege einen Zeitpunkt für den Fund an.": {"create_timeline_moment"},
            "Schlage eine Beziehung von Mara zu Tarek vor.": {"create_relationship"},
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                self.assertEqual(required_proposal_kinds(question), expected)

    def test_presence_flags_backward_travel_between_different_places(self):
        figures = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [
                {"id": "m1", "title": "Aufbruch", "date": "1421-03-10"},
                {"id": "m2", "title": "Ankunft", "date": "1421-03-05"},
            ],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "frostkloster", "momentId": "m2"},
            ],
        }
        issues = presence_consistency_issues(figures)
        self.assertEqual(len(issues), 1)
        self.assertIn("Mara", issues[0])
        self.assertIn("vor dem Ausgangsdatum", issues[0])

    def test_presence_flags_same_day_travel_between_different_places(self):
        figures = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [
                {"id": "m1", "title": "Aufbruch", "date": "1421-03-10"},
                {"id": "m2", "title": "Ankunft", "date": "1421-03-10"},
            ],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "frostkloster", "momentId": "m2"},
            ],
        }
        self.assertEqual(
            presence_consistency_issues(figures),
            ["Mara wechselt laut Anwesenheit am selben Tag den Ort"],
        )

    def test_presence_is_silent_when_dates_are_plausible_or_missing(self):
        plausible = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [{"id": "m1", "date": "1421-03-01"}, {"id": "m2", "date": "1421-03-10"}],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "frostkloster", "momentId": "m2"},
            ],
        }
        self.assertEqual(presence_consistency_issues(plausible), [])
        undated = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [{"id": "m1"}, {"id": "m2"}],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "frostkloster", "momentId": "m2"},
            ],
        }
        self.assertEqual(presence_consistency_issues(undated), [])

    def test_presence_ignores_staying_in_the_same_place(self):
        figures = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [{"id": "m1", "date": "1421-03-10"}, {"id": "m2", "date": "1421-03-10"}],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "hafen", "momentId": "m2"},
            ],
        }
        self.assertEqual(presence_consistency_issues(figures), [])

    def test_world_audit_reports_presence_entries_inspected_and_folds_in_its_issues(self):
        figures = {
            "nodes": [{"id": "mara", "name": "Mara"}],
            "timeline": [{"id": "m1", "date": "1421-03-10"}, {"id": "m2", "date": "1421-03-05"}],
            "edges": [],
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"id": "p2", "elementId": "mara", "placeId": "frostkloster", "momentId": "m2"},
            ],
        }
        audit = validate_world(figures)
        self.assertEqual(audit["inspected"]["presenceEntries"], 2)
        self.assertEqual(len(audit["issues"]), 1)

    def test_fallback_uses_the_exact_required_tool(self):
        runtime = AssistantRuntime.__new__(AssistantRuntime)
        figures = {
            "nodes": [{"id": "tarek", "name": "Tarek Venn"}, {"id": "nima", "name": "Nima Nox"}],
            "edges": [{"id": "e-mara-iven", "label": "Misstrauen"}],
            "timeline": [{"id": "trial", "title": "Der Prozess"}],
        }
        update = runtime._forced_proposal(
            "Ergänze bei Tarek Venn im Profil die Notiz: Vorsichtig.", "[]", figures
        )
        state = runtime._forced_proposal(
            "Ändere den Stand der Beziehung e-mara-iven am Zeitpunkt trial auf 'Verbündet', aktiv und ungerichtet.",
            "[]",
            figures,
        )
        death = runtime._forced_proposal(
            "Markiere Nima Nox am Zeitpunkt trial als verstorben.", "[]", figures
        )
        self.assertEqual(update["kind"], "update_element")
        self.assertEqual(state["kind"], "set_relationship_at_moment")
        self.assertFalse(state["patch"]["directed"])
        self.assertEqual(death, {"kind": "mark_deceased", "elementId": "nima", "momentId": "trial"})


if __name__ == "__main__":
    unittest.main()
