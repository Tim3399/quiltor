import unittest

from backend.core.mirror import markdown_body
from backend.core.validation import valid_manuscript


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
