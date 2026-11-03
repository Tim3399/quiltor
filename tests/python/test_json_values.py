"""as_object and as_array narrow decoded JSON and refuse everything else."""

import unittest

from quiltor.domain.json_values import as_array, as_object


class AsObjectTests(unittest.TestCase):
    def test_a_dict_with_string_keys_is_returned_as_the_same_object(self):
        value = {"a": 1, "b": [2]}
        self.assertIs(as_object(value), value)

    def test_an_empty_dict_is_an_object(self):
        value: dict[str, object] = {}
        self.assertIs(as_object(value), value)

    def test_nested_values_are_left_untouched(self):
        inner = {"c": None}
        value = {"a": inner, "b": [inner]}
        result = as_object(value)
        assert result is not None
        self.assertIs(result["a"], inner)
        self.assertEqual(result["b"], [inner])

    def test_a_dict_with_a_non_string_key_is_not_an_object(self):
        self.assertIsNone(as_object({1: "a"}))
        self.assertIsNone(as_object({"a": 1, 2: "b"}))
        self.assertIsNone(as_object({None: 1}))

    def test_a_list_is_not_an_object(self):
        self.assertIsNone(as_object([]))
        self.assertIsNone(as_object([("a", 1)]))

    def test_scalars_and_none_are_not_objects(self):
        for value in (None, 0, 1.5, True, "", "text", b"x", ("a",), {"a"}):
            with self.subTest(value=value):
                self.assertIsNone(as_object(value))


class AsArrayTests(unittest.TestCase):
    def test_a_list_is_returned_as_the_same_object(self):
        value = [1, "a", None]
        self.assertIs(as_array(value), value)

    def test_an_empty_list_is_an_array(self):
        value: list[object] = []
        self.assertIs(as_array(value), value)

    def test_nested_items_are_left_untouched(self):
        inner = {"a": 1}
        result = as_array([inner, [inner]])
        assert result is not None
        self.assertIs(result[0], inner)

    def test_a_dict_is_not_an_array(self):
        self.assertIsNone(as_array({}))
        self.assertIsNone(as_array({"a": 1}))

    def test_scalars_none_and_tuples_are_not_arrays(self):
        for value in (None, 0, 1.5, False, "", "text", b"x", (1,), {1}):
            with self.subTest(value=value):
                self.assertIsNone(as_array(value))


if __name__ == "__main__":
    unittest.main()
