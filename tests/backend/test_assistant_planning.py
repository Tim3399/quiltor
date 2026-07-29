import unittest

from backend.assistant import complete_compound_proposals, required_proposal_kinds, validate_proposals


FIGURES = {"nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}], "edges": [], "timeline": []}


class AssistantPlanningTests(unittest.TestCase):
    def test_arrangement_rejects_unrelated_timeline_proposals(self):
        question = "Sortiere die Elemente thematisch neu."
        raw = [{"kind": "create_timeline_moment", "tempId": "new:moment:no", "moment": {"title": "Falsch"}}]
        valid = validate_proposals(raw, FIGURES, question)
        self.assertEqual(required_proposal_kinds(question), {"arrange_elements"})
        self.assertEqual(complete_compound_proposals(question, valid, FIGURES), [{"kind": "arrange_elements", "strategy": "thematic"}])

    def test_family_creation_is_completed_with_relationship_and_age(self):
        question = "Lege Igor an. Igor ist der Sohn von Tarek Venn und 4 Jahre alt."
        raw = [{"kind": "create_element", "tempId": "new:igor", "element": {"type": "person", "name": "Igor", "profile": "Kind"}}]
        valid = validate_proposals(raw, FIGURES, question)
        completed = complete_compound_proposals(question, valid, FIGURES)
        self.assertEqual({item["kind"] for item in completed}, {"create_element", "create_relationship"})
        self.assertEqual(completed[0]["element"]["profile"]["alter"], "4")
        self.assertEqual(completed[1]["relationship"]["to"], "tarek")

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


if __name__ == "__main__":
    unittest.main()
