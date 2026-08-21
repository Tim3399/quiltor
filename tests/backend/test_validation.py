import unittest

from backend.core.mirror import markdown_body
from backend.core.validation import valid_figures, valid_manuscript


class FigureTemporalValidationTests(unittest.TestCase):
    def state(self):
        return {
            "nodes": [
                {"id": "ada", "name": "Ada", "x": 0, "y": 0, "type": "person"},
                {"id": "harbor", "name": "Hafen", "x": 10, "y": 10, "type": "ort"},
            ],
            "edges": [
                {
                    "id": "knows",
                    "from": "ada",
                    "to": "harbor",
                    "versions": [
                        {
                            "momentId": "storm",
                            "label": "flieht nach",
                            "active": True,
                        }
                    ],
                }
            ],
            "timeline": [
                {"id": "origin", "title": "Anfang", "time": -4, "position": 0},
                {"id": "storm", "title": "Sturm", "time": 0, "position": 1},
                {"id": "rescue", "title": "Rettung", "time": 0, "position": 2},
            ],
            "presence": [
                {"id": "base", "elementId": "ada", "placeId": "harbor"},
                {
                    "id": "at-storm",
                    "elementId": "ada",
                    "placeId": "harbor",
                    "momentId": "storm",
                },
            ],
        }

    def test_accepts_signed_and_simultaneous_moments_with_valid_temporal_references(self):
        self.assertTrue(valid_figures(self.state()))

    def test_rejects_duplicate_or_malformed_moments(self):
        duplicate = self.state()
        duplicate["timeline"][2]["id"] = "storm"
        self.assertFalse(valid_figures(duplicate))

        fractional = self.state()
        fractional["timeline"][0]["time"] = -1.5
        self.assertFalse(valid_figures(fractional))

        fractional_position = self.state()
        fractional_position["timeline"][1]["position"] = 1.5
        self.assertFalse(valid_figures(fractional_position))

    def test_rejects_dangling_and_duplicate_relationship_states(self):
        dangling = self.state()
        dangling["edges"][0]["versions"][0]["momentId"] = "missing"
        self.assertFalse(valid_figures(dangling))

        duplicate = self.state()
        duplicate["edges"][0]["versions"].append(
            {"momentId": "storm", "label": "zweiter Stand", "active": False}
        )
        self.assertFalse(valid_figures(duplicate))

    def test_rejects_non_place_dangling_and_duplicate_logical_presence(self):
        non_place = self.state()
        non_place["presence"][0]["placeId"] = "ada"
        self.assertFalse(valid_figures(non_place))

        dangling = self.state()
        dangling["presence"][1]["momentId"] = "missing"
        self.assertFalse(valid_figures(dangling))

        duplicate = self.state()
        duplicate["presence"].append(
            {
                "id": "duplicate-at-storm",
                "elementId": "ada",
                "placeId": "harbor",
                "momentId": "storm",
            }
        )
        self.assertFalse(valid_figures(duplicate))

    def test_rejects_death_at_a_missing_moment(self):
        state = self.state()
        state["nodes"][0]["diedMomentId"] = "missing"
        self.assertFalse(valid_figures(state))


class ManuscriptMentionValidationTests(unittest.TestCase):
    def manuscript(self, mentions):
        return {
            "chapters": [
                {"id": "c1", "title": "", "body": "Mara und Bela", "note": "", "mentions": mentions}
            ]
        }

    def mention(self, **patch):
        value = {
            "id": "m1",
            "elementId": "n1",
            "from": 0,
            "to": 4,
            "surface": "Mara",
            "source": "deterministic",
            "confidence": 1,
        }
        value.update(patch)
        return value

    def test_accepts_valid_mentions_stored_as_chapter_extra_data(self):
        self.assertTrue(valid_manuscript(self.manuscript([self.mention()])))

    def test_rejects_bad_bounds_surface_overlap_and_duplicate_ids(self):
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(to=99)])))
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(surface="Else")])))
        self.assertFalse(
            valid_manuscript(
                self.manuscript(
                    [self.mention(), self.mention(**{"from": 2, "to": 8}, surface="ra und")]
                )
            )
        )
        self.assertFalse(
            valid_manuscript(
                self.manuscript(
                    [self.mention(), self.mention(**{"from": 9, "to": 13}, surface="Bela")]
                )
            )
        )

    def test_accepts_supported_grammar_settings_and_rejects_unknown_values(self):
        manuscript = self.manuscript([])
        self.assertTrue(
            valid_manuscript({**manuscript, "language": "de-DE", "grammarMode": "automatic"})
        )
        self.assertFalse(valid_manuscript({**manuscript, "language": "en-US"}))
        self.assertFalse(valid_manuscript({**manuscript, "grammarMode": "always"}))


class ManuscriptMarkValidationTests(unittest.TestCase):
    """Bold and italic are ranges over the body, held to the same standard as a mention."""

    def manuscript(self, marks):
        return {
            "chapters": [
                {"id": "c1", "title": "", "body": "Mara und Bela", "note": "", "marks": marks}
            ]
        }

    def test_accepts_ranges_inside_the_body_including_overlapping_kinds(self):
        self.assertTrue(valid_manuscript(self.manuscript([])))
        self.assertTrue(valid_manuscript(self.manuscript([{"from": 0, "to": 4, "kind": "bold"}])))
        # Fett und kursiv sind verschiedene Arten: die dürfen einander überlagern.
        self.assertTrue(
            valid_manuscript(
                self.manuscript(
                    [
                        {"from": 0, "to": 13, "kind": "bold"},
                        {"from": 5, "to": 8, "kind": "italic"},
                    ]
                )
            )
        )
        # Aneinandergrenzend ist erlaubt, wie bei den Erwähnungen.
        self.assertTrue(
            valid_manuscript(
                self.manuscript(
                    [
                        {"from": 0, "to": 4, "kind": "bold"},
                        {"from": 4, "to": 8, "kind": "bold"},
                    ]
                )
            )
        )

    def test_rejects_unknown_kinds_bad_bounds_and_overlap_within_one_kind(self):
        self.assertFalse(
            valid_manuscript(self.manuscript([{"from": 0, "to": 4, "kind": "underline"}]))
        )
        self.assertFalse(valid_manuscript(self.manuscript([{"from": 0, "to": 99, "kind": "bold"}])))
        self.assertFalse(valid_manuscript(self.manuscript([{"from": 4, "to": 4, "kind": "bold"}])))
        self.assertFalse(valid_manuscript(self.manuscript([{"from": -1, "to": 4, "kind": "bold"}])))
        self.assertFalse(
            valid_manuscript(self.manuscript([{"from": 0, "to": 4.5, "kind": "bold"}]))
        )
        self.assertFalse(
            valid_manuscript(
                self.manuscript(
                    [
                        {"from": 0, "to": 6, "kind": "bold"},
                        {"from": 3, "to": 9, "kind": "bold"},
                    ]
                )
            )
        )
        self.assertFalse(valid_manuscript(self.manuscript("fett")))


class MarkdownMirrorTests(unittest.TestCase):
    """The mirror is Markdown, so there -- and only there -- the ranges become markers."""

    def test_writes_markers_for_the_ranges_and_leaves_plain_text_alone(self):
        self.assertEqual(markdown_body("Mara und Bela", []), "Mara und Bela")
        self.assertEqual(
            markdown_body("Mara und Bela", [{"from": 0, "to": 4, "kind": "bold"}]),
            "**Mara** und Bela",
        )
        self.assertEqual(
            markdown_body("Mara und Bela", [{"from": 9, "to": 13, "kind": "italic"}]),
            "Mara und *Bela*",
        )
        self.assertEqual(
            markdown_body(
                "Mara",
                [{"from": 0, "to": 4, "kind": "bold"}, {"from": 0, "to": 4, "kind": "italic"}],
            ),
            "***Mara***",
        )

    def test_keeps_the_markers_off_whitespace_and_out_of_paragraph_breaks(self):
        self.assertEqual(
            markdown_body("Mara und Bela", [{"from": 4, "to": 13, "kind": "italic"}]),
            "Mara *und Bela*",
        )
        self.assertEqual(
            markdown_body("Eins\n\nZwei", [{"from": 0, "to": 10, "kind": "bold"}]),
            "**Eins**\n\n**Zwei**",
        )

    def test_survives_ranges_that_no_longer_fit_the_text(self):
        self.assertEqual(markdown_body("Mara", [{"from": 0, "to": 99, "kind": "bold"}]), "**Mara**")
        self.assertEqual(markdown_body("Mara", [{"from": 0, "to": None, "kind": "bold"}]), "Mara")


if __name__ == "__main__":
    unittest.main()
