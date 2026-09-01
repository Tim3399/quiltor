import json
import unittest

from quiltor.domain.story_world.knowledge import KnowledgeChunk, KnowledgeContextClass
from quiltor.modules.assistant.planner import plan


class AssistantPlannerContextTests(unittest.TestCase):
    def _capture_plan(self, context):
        captured = {}

        def invoke(payload):
            captured.update(payload)
            return {
                "goal": "Kontext prüfen",
                "steps": ["Quellen vergleichen"],
                "searchQueries": [],
                "requiredKinds": [],
            }

        plan("Analysiere die möglichen Widersprüche.", context, invoke)
        return captured

    def test_compact_context_summary_preserves_server_owned_context_classes(self):
        context = [
            KnowledgeChunk(
                "element:mara",
                "element",
                "Mara",
                "Archivarin",
                {"workspace": "figures", "id": "mara"},
                context_class=KnowledgeContextClass.CANON,
            ),
            KnowledgeChunk(
                "chapter:c1:0",
                "chapter",
                "Kapitel 1",
                "Mara betritt das Archiv.",
                {"workspace": "text", "id": "c1"},
                context_class=KnowledgeContextClass.MANUSCRIPT,
            ),
            KnowledgeChunk(
                "storyboard:idea",
                "storyboard-note",
                "Möglicher Wendepunkt",
                "Vielleicht verrät Mara den Rat.",
                {"workspace": "storyboard", "id": "idea"},
                context_class=KnowledgeContextClass.PLANNING,
            ),
        ]

        payload = self._capture_plan(context)
        user_prompt = payload["messages"][1]["content"]
        raw_summary = user_prompt.split("INITIAL MATCHES:\n", 1)[1].rsplit("\n/no_think", 1)[0]
        summary = json.loads(raw_summary)

        self.assertEqual(
            [item["contextClass"] for item in summary],
            ["canon", "manuscript", "planning"],
        )

    def test_planner_policy_keeps_planning_non_canonical_and_read_only(self):
        payload = self._capture_plan([])
        policy = payload["messages"][0]["content"]

        self.assertIn("planning is hypothetical, non-canonical Storyboard material", policy)
        self.assertIn("Never treat planning context as an established world fact", policy)
        self.assertIn("never derive a canonical mutation or required proposal kind", policy)
        self.assertIn("read-only planning analysis", policy)


if __name__ == "__main__":
    unittest.main()
