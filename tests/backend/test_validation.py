import unittest

from backend.core.validation import valid_manuscript


class ManuscriptMentionValidationTests(unittest.TestCase):
    def manuscript(self, mentions):
        return {"chapters": [{"id": "c1", "title": "", "body": "Mara und Bela", "note": "", "mentions": mentions}]}

    def mention(self, **patch):
        value = {"id": "m1", "elementId": "n1", "from": 0, "to": 4, "surface": "Mara", "source": "deterministic", "confidence": 1}
        value.update(patch)
        return value

    def test_accepts_valid_mentions_stored_as_chapter_extra_data(self):
        self.assertTrue(valid_manuscript(self.manuscript([self.mention()])))

    def test_rejects_bad_bounds_surface_overlap_and_duplicate_ids(self):
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(to=99)])))
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(surface="Else")])))
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(), self.mention(**{"from": 2, "to": 8}, surface="ra und")])))
        self.assertFalse(valid_manuscript(self.manuscript([self.mention(), self.mention(**{"from": 9, "to": 13}, surface="Bela")])))

    def test_accepts_supported_grammar_settings_and_rejects_unknown_values(self):
        manuscript = self.manuscript([])
        self.assertTrue(valid_manuscript({**manuscript, "language": "de-DE", "grammarMode": "automatic"}))
        self.assertFalse(valid_manuscript({**manuscript, "language": "en-US"}))
        self.assertFalse(valid_manuscript({**manuscript, "grammarMode": "always"}))


if __name__ == "__main__":
    unittest.main()
