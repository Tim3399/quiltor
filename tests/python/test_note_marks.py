"""valid_note_marks accepts canonical spans and refuses every other shape."""

import unittest

from quiltor.domain.notes.marks import MAX_NOTE_MARKS, valid_note_marks


def check(text: object, marks: object) -> bool:
    return valid_note_marks({"text": text, "noteMarks": marks}, "text")


def mark(kind: str, start: object, end: object, **extra: object) -> dict[str, object]:
    return {"kind": kind, "from": start, "to": end, **extra}


class ValidNoteMarksTests(unittest.TestCase):
    def test_a_missing_marks_field_is_valid(self):
        self.assertTrue(valid_note_marks({"text": "abc"}, "text"))

    def test_an_absent_note_defaults_to_empty_text(self):
        self.assertTrue(valid_note_marks({}, "text"))
        self.assertFalse(valid_note_marks({"noteMarks": [mark("bold", 0, 1)]}, "text"))

    def test_bold_and_italic_spans_may_overlap_each_other(self):
        self.assertTrue(check("abcdef", [mark("bold", 0, 4), mark("italic", 2, 6)]))

    def test_a_heading_covering_exactly_one_line_is_valid(self):
        self.assertTrue(check("one\ntwo\nthree", [mark("heading", 4, 7, level=2)]))

    def test_offsets_are_utf16_units(self):
        # U+1F600 is two UTF-16 units, so "b" sits at 2..3.
        self.assertTrue(check("\U0001f600b", [mark("bold", 2, 3)]))
        self.assertFalse(check("\U0001f600b", [mark("bold", 1, 3)]))

    def test_a_non_string_text_is_refused(self):
        self.assertFalse(check(5, []))

    def test_marks_that_are_not_a_list_are_refused(self):
        self.assertFalse(check("abc", {"kind": "bold"}))
        self.assertFalse(check("abc", None))

    def test_more_than_the_maximum_number_of_marks_is_refused(self):
        self.assertFalse(check("abc", [mark("bold", 0, 1)] * (MAX_NOTE_MARKS + 1)))

    def test_a_mark_that_is_not_an_object_is_refused(self):
        self.assertFalse(check("abc", ["bold"]))

    def test_an_unknown_kind_is_refused(self):
        self.assertFalse(check("abc", [mark("underline", 0, 1)]))

    def test_non_integer_or_boolean_bounds_are_refused(self):
        self.assertFalse(check("abc", [mark("bold", "0", 1)]))
        self.assertFalse(check("abc", [mark("bold", 0, 1.0)]))
        self.assertFalse(check("abc", [mark("bold", False, 1)]))

    def test_negative_empty_or_inverted_ranges_are_refused(self):
        self.assertFalse(check("abc", [mark("bold", -1, 1)]))
        self.assertFalse(check("abc", [mark("bold", 1, 1)]))
        self.assertFalse(check("abc", [mark("bold", 2, 1)]))

    def test_a_range_past_the_end_of_the_text_is_refused(self):
        self.assertFalse(check("abc", [mark("bold", 0, 4)]))

    def test_a_heading_level_must_be_one_two_or_three(self):
        self.assertFalse(check("abc", [mark("heading", 0, 3)]))
        self.assertFalse(check("abc", [mark("heading", 0, 3, level=4)]))
        self.assertFalse(check("abc", [mark("heading", 0, 3, level="1")]))
        self.assertFalse(check("abc", [mark("heading", 0, 3, level=True)]))

    def test_a_level_on_an_inline_mark_is_refused(self):
        self.assertFalse(check("abc", [mark("bold", 0, 3, level=1)]))

    def test_a_heading_must_start_at_a_line_start(self):
        self.assertFalse(check("ab\ncd", [mark("heading", 1, 2, level=1)]))

    def test_a_heading_must_end_at_a_line_end(self):
        self.assertFalse(check("ab\ncd", [mark("heading", 0, 1, level=1)]))

    def test_a_heading_may_not_span_a_line_break(self):
        self.assertFalse(check("ab\ncd", [mark("heading", 0, 5, level=1)]))

    def test_two_headings_may_not_share_a_start(self):
        self.assertFalse(
            check("abc", [mark("heading", 0, 3, level=1), mark("heading", 0, 3, level=2)])
        )

    def test_two_marks_of_one_inline_kind_may_not_overlap(self):
        self.assertFalse(check("abcdef", [mark("bold", 0, 4), mark("bold", 3, 6)]))

    def test_touching_marks_of_one_inline_kind_are_valid(self):
        self.assertTrue(check("abcdef", [mark("bold", 0, 3), mark("bold", 3, 6)]))


if __name__ == "__main__":
    unittest.main()
