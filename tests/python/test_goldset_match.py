"""The T-289 gold-set matcher: hand-counted cases for every rule of plan sections 4 and 6."""

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "tools/evaluation/assistant/goldset_match.py"
_spec = importlib.util.spec_from_file_location("goldset_match", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
gm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gm)


def figure(gold_id, *names, required=True):
    return {
        "id": gold_id,
        "category": "figure",
        "types": ["figur"],
        "names": list(names),
        "required": required,
    }


def place(gold_id, *names, required=True):
    return {
        "id": gold_id,
        "category": "place",
        "types": ["ort"],
        "names": list(names),
        "required": required,
    }


def create(name, element_type="figur", temp_id=None):
    proposal = {"kind": "create_element", "element": {"type": element_type, "name": name}}
    if temp_id:
        proposal["tempId"] = temp_id
    return proposal


def relation(source, target, label, directed=True, relationship_kind="general"):
    return {
        "kind": "create_relationship",
        "relationship": {
            "from": source,
            "to": target,
            "label": label,
            "directed": directed,
            "relationshipKind": relationship_kind,
        },
    }


def task(gold, kind="extract", mode="A", **extra):
    return {"id": "t", "kind": kind, "mode": mode, "gold": gold, "titles": ["hauptmann"], **extra}


def counts(result, category):
    return result["counts"][category]


ARVID = figure("g-arvid", "Selm Arvid", "Arvid", "Selm", "Hauptmann")


class ElementMatching(unittest.TestCase):
    def test_exact_name_is_a_hit(self):
        result = gm.match_task(task([ARVID]), [create("Selm Arvid")])
        self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 0, "fn": 0})

    def test_alias_is_a_hit(self):
        result = gm.match_task(task([ARVID]), [create("der Hauptmann")])
        self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 0, "fn": 0})

    def test_normalisation_ignores_case_punctuation_and_sharp_s(self):
        gold = [place("g-strasse", "Lange Straße")]
        result = gm.match_task(task(gold), [create("LANGE STRASSE!", "ort")])
        self.assertEqual(counts(result, "place")["tp"], 1)

    def test_unique_partial_name_counts_like_an_alias(self):
        gold = [figure("g-wenke", "Wenke Dorn Weber")]
        result = gm.match_task(task(gold), [create("Dorn Weber")])
        self.assertEqual(counts(result, "figure")["tp"], 1)

    def test_ambiguous_partial_name_is_a_false_positive(self):
        gold = [figure("g-a", "Ilka Saar"), figure("g-b", "Jon Saar")]
        result = gm.match_task(task(gold), [create("Saar")])
        self.assertEqual(counts(result, "figure"), {"tp": 0, "fp": 1, "fn": 2})

    def test_partial_name_is_ambiguous_across_categories(self):
        gold = [figure("g-a", "Ilka Saar"), place("g-p", "Saar Ufer")]
        result = gm.match_task(task(gold), [create("Saar")])
        self.assertEqual(counts(result, "figure")["tp"], 0)

    def test_wrong_type_is_a_partial_hit_that_lowers_precision_and_recall(self):
        result = gm.match_task(task([ARVID]), [create("Selm Arvid", "ort")])
        metrics = gm.run_metrics([result], [task([ARVID])])["perCategory"]["figure"]
        self.assertEqual((metrics["p"], metrics["r"], metrics["f1"]), (0.5, 0.5, 0.5))

    def test_duplicate_is_a_false_positive(self):
        result = gm.match_task(task([ARVID]), [create("Selm Arvid"), create("Arvid")])
        self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 1, "fn": 0})

    def test_unmatched_proposal_is_a_false_positive_and_gold_is_missed(self):
        result = gm.match_task(task([ARVID]), [create("Bela")])
        self.assertEqual(counts(result, "figure"), {"tp": 0, "fp": 1, "fn": 1})

    def test_assignment_does_not_depend_on_proposal_order(self):
        # F-289-4: A has the exact name but the wrong type, B an alias with the right type.
        a = create("Selm Arvid", "ort")
        b = create("Hauptmann", "figur")
        first = gm.match_task(task([ARVID]), [a, b])
        second = gm.match_task(task([ARVID]), [b, a])
        for result in (first, second):
            self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 0, "fn": 0})
            self.assertEqual(counts(result, "place"), {"tp": 0, "fp": 1, "fn": 0})


class OptionalEntries(unittest.TestCase):
    def test_found_optional_entry_is_neutral(self):
        # F-289-2: model X finds the three optional entries and not the required one.
        gold = [
            figure("g-req", "Mara"),
            figure("g-o1", "Hedda", required=False),
            figure("g-o2", "Jorn", required=False),
            figure("g-o3", "Pell", required=False),
        ]
        result = gm.match_task(task(gold), [create("Hedda"), create("Jorn"), create("Pell")])
        self.assertEqual(counts(result, "figure"), {"tp": 0, "fp": 0, "fn": 1})
        self.assertEqual(result["optionalFound"], 3)
        self.assertEqual(gm.run_metrics([result], [task(gold)])["perCategory"]["figure"]["r"], 0)

    def test_missing_optional_entry_is_not_a_miss(self):
        gold = [figure("g-o", "Hedda", required=False)]
        result = gm.match_task(task(gold), [])
        self.assertEqual(counts(result, "figure"), {"tp": 0, "fp": 0, "fn": 0})


KEY = {
    "id": "g-key",
    "category": "thing",
    "types": ["objekt"],
    "names": ["Torschlüssel", "Schlüssel"],
}


def owns(required=True):
    return {
        "id": "g-owns",
        "category": "relation",
        "from": "g-arvid",
        "to": "g-key",
        "directed": True,
        "relationshipKind": "general",
        "synonyms": ["besitzt", "trägt"],
        "required": required,
    }


class RelationMatching(unittest.TestCase):
    def elements(self):
        return [
            create("Selm Arvid", temp_id="new:arvid"),
            create("Torschlüssel", "objekt", temp_id="new:key"),
        ]

    def relation_counts(self, *relations, gold=None):
        gold = gold or [ARVID, KEY, owns()]
        return counts(gm.match_task(task(gold), [*self.elements(), *relations]), "relation")

    def test_triple_with_synonym_inside_label_is_a_hit(self):
        self.assertEqual(
            self.relation_counts(relation("new:arvid", "new:key", "trägt bei sich")),
            {"tp": 1, "fp": 0, "fn": 0},
        )

    def test_existing_ids_resolve_as_endpoints(self):
        known = [{"id": "g-arvid", "type": "figur", "names": ["Selm Arvid"]}]
        gold = [KEY, owns()]
        result = gm.match_task(
            task(gold, known=known),
            [
                create("Torschlüssel", "objekt", temp_id="new:key"),
                relation("g-arvid", "new:key", "besitzt"),
            ],
        )
        self.assertEqual(counts(result, "relation")["tp"], 1)

    def test_reversed_direction_is_a_partial_hit(self):
        self.assertEqual(
            self.relation_counts(relation("new:key", "new:arvid", "besitzt")),
            {"tp": 0.5, "fp": 0.5, "fn": 0.5},
        )

    def test_wrong_label_is_a_partial_hit(self):
        self.assertEqual(
            self.relation_counts(relation("new:arvid", "new:key", "fürchtet")),
            {"tp": 0.5, "fp": 0.5, "fn": 0.5},
        )

    def test_wrong_kind_is_a_partial_hit(self):
        self.assertEqual(
            self.relation_counts(
                relation("new:arvid", "new:key", "besitzt", relationship_kind="kinship")
            ),
            {"tp": 0.5, "fp": 0.5, "fn": 0.5},
        )

    def test_unresolved_endpoint_is_a_false_positive(self):
        self.assertEqual(
            self.relation_counts(relation("new:arvid", "new:nobody", "besitzt")),
            {"tp": 0, "fp": 1, "fn": 1},
        )

    def test_two_triples_on_one_pair_take_full_hits_first(self):
        allies = {
            **owns(),
            "id": "g-allies",
            "synonyms": ["verbündet"],
            "to": "g-wenke",
            "directed": False,
        }
        rivals = {**allies, "id": "g-rivals", "synonyms": ["rivalen"]}
        wenke = figure("g-wenke", "Wenke Dorn")
        gold = [ARVID, wenke, allies, rivals]
        proposals = [
            create("Selm Arvid", temp_id="new:arvid"),
            create("Wenke Dorn", temp_id="new:wenke"),
            relation("new:arvid", "new:wenke", "Rivalen", directed=False),
            relation("new:arvid", "new:wenke", "verbündet", directed=False),
        ]
        self.assertEqual(
            counts(gm.match_task(task(gold), proposals), "relation"), {"tp": 2, "fp": 0, "fn": 0}
        )

    def test_relationship_state_counts_with_its_patch_label(self):
        gold = [ARVID, KEY, owns()]
        known_relationships = {"r1": {"from": "g-arvid", "to": "g-key", "directed": True}}
        result = gm.match_task(
            task(gold, knownRelationships=known_relationships, known=[]),
            [
                *self.elements(),
                {
                    "kind": "set_relationship_at_moment",
                    "relationshipId": "r1",
                    "patch": {"label": "besitzt"},
                },
            ],
        )
        self.assertEqual(counts(result, "relation")["tp"], 1)

    def test_relation_to_an_optional_element_without_gold_relation_is_a_false_positive(self):
        gold = [ARVID, figure("g-hedda", "Hedda", required=False)]
        result = gm.match_task(
            task(gold),
            [
                create("Selm Arvid", temp_id="new:a"),
                create("Hedda", temp_id="new:h"),
                relation("new:a", "new:h", "Enkel"),
            ],
        )
        self.assertEqual(counts(result, "relation"), {"tp": 0, "fp": 1, "fn": 0})


GATE = {
    "id": "g-ev",
    "category": "event",
    "keywords": ["Tor"],
    "refs": ["g-arvid"],
    "date": "14. März 1803",
}


def moment(title, note="", date=""):
    return {
        "kind": "create_timeline_moment",
        "moment": {"title": title, "note": note, "date": date},
    }


class EventMatching(unittest.TestCase):
    def event_counts(self, proposal, gold_event=GATE):
        return counts(
            gm.match_task(task([ARVID, gold_event]), [create("Selm Arvid"), proposal]), "event"
        )

    def test_reference_in_note_and_keyword_in_title_is_a_hit(self):
        self.assertEqual(
            self.event_counts(moment("Das Tor fällt", note="Arvid öffnet es")),
            {"tp": 1, "fp": 0, "fn": 0},
        )

    def test_keyword_without_reference_is_a_partial_hit(self):
        self.assertEqual(
            self.event_counts(moment("Das Tor fällt")), {"tp": 0.5, "fp": 0.5, "fn": 0.5}
        )

    def test_no_keyword_is_a_false_positive(self):
        self.assertEqual(self.event_counts(moment("Arvid schläft")), {"tp": 0, "fp": 1, "fn": 1})

    def test_date_one_day_off_is_within_tolerance(self):
        self.assertEqual(self.event_counts(moment("Arvid am Tor", date="1803-03-15"))["tp"], 1)

    def test_date_two_days_off_is_a_partial_hit(self):
        self.assertEqual(self.event_counts(moment("Arvid am Tor", date="16. März 1803"))["tp"], 0.5)

    def test_unparsable_date_counts_as_empty(self):
        self.assertEqual(self.event_counts(moment("Arvid am Tor", date="im Frühjahr"))["tp"], 1)

    def test_relative_gold_date_is_not_checked(self):
        relative = {**GATE, "date": "nach dem Sturm"}
        self.assertEqual(
            self.event_counts(moment("Arvid am Tor", date="1900-01-01"), relative)["tp"], 1
        )

    def test_date_formats(self):
        self.assertEqual(gm.parse_absolute_date("14. März 1803").isoformat(), "1803-03-14")
        self.assertEqual(gm.parse_absolute_date("March 14, 1803").isoformat(), "1803-03-14")
        self.assertEqual(gm.parse_absolute_date("14 March 1803").isoformat(), "1803-03-14")
        self.assertIsNone(gm.parse_absolute_date("1803-02-31"))
        self.assertIsNone(gm.parse_absolute_date("zwei Tage später"))


class PresenceMatching(unittest.TestCase):
    def test_pair_is_a_hit_and_the_moment_is_ignored(self):
        fort = place("g-fort", "Fort Kehrwieder")
        presence = {"id": "g-pr", "category": "presence", "element": "g-arvid", "place": "g-fort"}
        proposals = [
            create("Selm Arvid", temp_id="new:a"),
            create("Fort Kehrwieder", "ort", temp_id="new:f"),
            {
                "kind": "set_presence",
                "elementId": "new:a",
                "placeId": "new:f",
                "momentId": "anything",
            },
            {"kind": "set_presence", "elementId": "new:a", "placeId": "new:gone"},
        ]
        result = gm.match_task(task([ARVID, fort, presence]), proposals)
        self.assertEqual(counts(result, "presence"), {"tp": 1, "fp": 1, "fn": 0})


class MissingFigures(unittest.TestCase):
    def test_only_figure_creates_count_and_known_figures_are_false_positives(self):
        gold = [figure("g-ilka", "Ilka Saar"), figure("g-fenn", "Fenn", "Bootsmann Fenn")]
        known = [{"id": "g-arvid", "type": "figur", "names": ["Selm Arvid"]}]
        proposals = [
            create("Ilka Saar"),
            create("Selm Arvid"),
            create("Fort", "ort"),
            moment("Tor"),
        ]
        result = gm.match_task(task(gold, kind="missing", known=known), proposals)
        self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 1, "fn": 1})
        self.assertEqual(result["offTask"], 2)


class GermanWordForms(unittest.TestCase):
    """Plan 4.5: a key meets a genitive and the member of a compound; no stemmer."""

    def event_counts(self, title, keyword="Brot", note="", refs=None, gold=None):
        event = {
            "id": "g-ev-form",
            "category": "event",
            "keywords": [keyword],
            "refs": refs or [],
        }
        return counts(
            gm.match_task(task([ARVID, event]), [create("Selm Arvid"), moment(title, note)]),
            "event",
        )

    def test_key_as_the_first_member_of_a_compound_is_a_hit(self):
        self.assertEqual(
            self.event_counts("Mittagsbrot im Fort", keyword="Mittag"),
            {"tp": 0.5, "fp": 0.5, "fn": 0.5},
        )

    def test_key_as_the_last_member_of_a_compound_is_a_hit(self):
        self.assertEqual(
            self.event_counts("Mittagsbrot im Fort"), {"tp": 0.5, "fp": 0.5, "fn": 0.5}
        )

    def test_key_of_three_characters_is_no_member_of_a_compound(self):
        self.assertEqual(
            self.event_counts("Toröffnung", keyword="Tor"), {"tp": 0, "fp": 1, "fn": 1}
        )

    def test_key_of_four_characters_is_a_member_of_a_compound(self):
        self.assertEqual(
            self.event_counts("Torwächter", keyword="Torw"), {"tp": 0.5, "fp": 0.5, "fn": 0.5}
        )

    def test_the_umlaut_is_folded_on_both_sides(self):
        self.assertEqual(self.event_counts("Rückkehr", keyword="Ruckkehr")["tp"], 0.5)
        self.assertEqual(self.event_counts("Ruckkehr", keyword="Rückkehr")["tp"], 0.5)
        self.assertEqual(
            self.event_counts("Rückkehr des Hauptmanns", keyword="Rückkehr")["tp"], 0.5
        )

    def test_genitive_of_a_key_is_a_hit(self):
        for title in ("Hauptmanns Rückkehr", "Die Ankunft des Hauptmannes"):
            with self.subTest(title=title):
                self.assertEqual(self.event_counts(title, keyword="Hauptmann")["tp"], 0.5, title)

    def test_apostrophe_genitive_of_a_key_is_a_hit(self):
        for title in ("Hauptmann's Rückkehr", "Hauptmann\u2019s Rückkehr"):
            with self.subTest(title=title):
                self.assertEqual(self.event_counts(title, keyword="Hauptmann")["tp"], 0.5, title)

    def test_an_unrelated_word_is_no_hit(self):
        self.assertEqual(self.event_counts("Brosche", keyword="Brot")["tp"], 0)
        self.assertEqual(self.event_counts("Brots", keyword="Brotes")["tp"], 0)

    def test_genitive_of_a_name_makes_the_reference(self):
        # "Arvids" in the title names Arvid: a full hit with the keyword, not a partial one.
        self.assertEqual(
            self.event_counts("Brot für Arvids Wache", refs=["g-arvid"]),
            {"tp": 1, "fp": 0, "fn": 0},
        )

    def test_a_name_is_no_compound_member(self):
        # Compounds count for keywords only; "Arvidhaus" does not name Arvid.
        self.assertEqual(
            self.event_counts("Brot im Arvidhaus", refs=["g-arvid"]),
            {"tp": 0.5, "fp": 0.5, "fn": 0.5},
        )


class RulesHeldByNoOtherTest(unittest.TestCase):
    """F-289-17: rules of plan 4 that stood without a test of their own."""

    def test_a_proposal_serves_one_gold_entry_only(self):
        # Two gold triples on one pair, one proposal: one hit and one miss, not a second
        # partial hit for the same proposal.
        allies = {
            **owns(),
            "id": "g-allies",
            "synonyms": ["verbündet"],
            "to": "g-wenke",
            "directed": False,
        }
        rivals = {**allies, "id": "g-rivals", "synonyms": ["rivalen"]}
        wenke = figure("g-wenke", "Wenke Dorn")
        proposals = [
            create("Selm Arvid", temp_id="new:arvid"),
            create("Wenke Dorn", temp_id="new:wenke"),
            relation("new:arvid", "new:wenke", "verbündet", directed=False),
        ]
        result = gm.match_task(task([ARVID, wenke, allies, rivals]), proposals)
        self.assertEqual(counts(result, "relation"), {"tp": 1, "fp": 0, "fn": 1})

    def test_title_words_do_not_count_when_comparing_a_partial_name(self):
        result = gm.match_task(task([ARVID]), [create("Hauptmann Arvid")])
        self.assertEqual(counts(result, "figure"), {"tp": 1, "fp": 0, "fn": 0})

    def test_the_endpoint_of_a_partial_element_hit_is_resolved(self):
        # Arvid is proposed with the wrong type (a partial hit); his relation still counts.
        result = gm.match_task(
            task([ARVID, KEY, owns()]),
            [
                create("Selm Arvid", "ort", temp_id="new:arvid"),
                create("Torschlüssel", "objekt", temp_id="new:key"),
                relation("new:arvid", "new:key", "besitzt"),
            ],
        )
        self.assertEqual(counts(result, "relation"), {"tp": 1, "fp": 0, "fn": 0})

    def test_the_name_wins_over_an_alias_whatever_the_order(self):
        by_alias = create("Hauptmann", temp_id="new:alias")
        by_name = create("Selm Arvid", temp_id="new:name")
        for proposals, expected in (([by_alias, by_name], 1), ([by_name, by_alias], 0)):
            with self.subTest(first=proposals[0]["tempId"]):
                result = gm.match_task(task([ARVID]), proposals)
                self.assertEqual([hit["proposal"] for hit in result["matches"]], [expected])

    def test_a_keyword_in_the_note_alone_is_no_keyword(self):
        event = {"id": "g-ev", "category": "event", "keywords": ["Tor"], "refs": ["g-arvid"]}
        result = gm.match_task(
            task([ARVID, event]),
            [create("Selm Arvid"), moment("Arvid am Morgen", note="Das Tor ist geschlossen")],
        )
        self.assertEqual(counts(result, "event"), {"tp": 0, "fp": 1, "fn": 1})

    def test_presence_is_the_ordered_pair_of_figure_and_place(self):
        fort = place("g-fort", "Fort Kehrwieder")
        presence = {"id": "g-pr", "category": "presence", "element": "g-arvid", "place": "g-fort"}
        result = gm.match_task(
            task([ARVID, fort, presence]),
            [
                create("Selm Arvid", temp_id="new:a"),
                create("Fort Kehrwieder", "ort", temp_id="new:f"),
                {"kind": "set_presence", "elementId": "new:f", "placeId": "new:a"},
            ],
        )
        self.assertEqual(counts(result, "presence"), {"tp": 0, "fp": 1, "fn": 1})

    def test_a_relationship_state_without_a_known_relationship_is_a_false_positive(self):
        # The patch names both ends itself; without a known relationship it still has no base.
        result = gm.match_task(
            task([ARVID, KEY, owns()], knownRelationships={}),
            [
                create("Selm Arvid", temp_id="new:arvid"),
                create("Torschlüssel", "objekt", temp_id="new:key"),
                {
                    "kind": "set_relationship_at_moment",
                    "relationshipId": "r-unknown",
                    "patch": {
                        "from": "new:arvid",
                        "to": "new:key",
                        "label": "besitzt",
                        "directed": True,
                    },
                },
            ],
        )
        self.assertEqual(counts(result, "relation"), {"tp": 0, "fp": 1, "fn": 1})


class Metrics(unittest.TestCase):
    def test_f1_is_zero_not_null_when_nothing_was_proposed(self):
        # F-289-3: three gold relations, no proposal.
        self.assertEqual(gm.scores(0, 0, 3), {"p": None, "r": 0.0, "f1": 0.0})

    def test_null_only_when_there_is_nothing_at_all(self):
        self.assertEqual(gm.scores(0, 0, 0), {"p": None, "r": None, "f1": None})

    def test_micro_and_macro_differ(self):
        gold = [ARVID, figure("g-wenke", "Wenke"), place("g-fort", "Fort")]
        the_task = task(gold)
        result = gm.match_task(
            the_task, [create("Selm Arvid"), create("Wenke"), create("Hafen", "ort")]
        )
        metrics = gm.run_metrics([result], [the_task])
        # figure: tp 2 -> F1 1.0; place: tp 0, fp 1, fn 1 -> F1 0.0.
        self.assertEqual(metrics["macro"]["f1"], 0.5)
        self.assertAlmostEqual(metrics["micro"]["f1"], 4 / 6)

    def test_macro_ignores_categories_without_gold_but_micro_counts_their_false_positives(self):
        the_task = task([ARVID])
        result = gm.match_task(the_task, [create("Selm Arvid"), create("Hafen", "ort")])
        metrics = gm.run_metrics([result], [the_task])
        self.assertEqual(metrics["macro"]["f1"], 1.0)
        self.assertEqual(metrics["micro"]["fp"], 1)

    def test_counts_are_summed_over_tasks_before_scoring(self):
        one, two = task([ARVID]), task([figure("g-wenke", "Wenke")])
        results = [gm.match_task(one, [create("Selm Arvid")]), gm.match_task(two, [create("Bela")])]
        figure_metrics = gm.run_metrics(results, [one, two])["perCategory"]["figure"]
        self.assertEqual(
            (figure_metrics["tp"], figure_metrics["fp"], figure_metrics["fn"]), (1, 1, 1)
        )
        self.assertEqual(figure_metrics["f1"], 0.5)

    def test_mode_b_scores_only_missing_and_reports_extract_false_positives_apart(self):
        # F-289-15: missing B finds both figures, extract B proposes two known figures again.
        known = [{"id": "g-arvid", "type": "figur", "names": ["Selm Arvid"]},
                 {"id": "g-wenke", "type": "figur", "names": ["Wenke"]}]  # fmt: skip
        missing = task(
            [figure("g-ilka", "Ilka Saar"), figure("g-fenn", "Fenn")],
            kind="missing",
            mode="B",
            known=known,
        )
        extract = task([], kind="extract", mode="B", known=known)
        results = [
            gm.match_task(missing, [create("Ilka Saar"), create("Fenn")]),
            gm.match_task(extract, [create("Selm Arvid"), create("Wenke")]),
        ]
        metrics = gm.run_metrics(results, [missing, extract])
        self.assertEqual(metrics["perCategory"]["figure"]["f1"], 1.0)
        self.assertEqual(metrics["falsePositives"]["figure"], 2)

    def test_extract_b_alone_has_no_f1(self):
        extract = task([], kind="extract", mode="B")
        metrics = gm.run_metrics([gm.match_task(extract, [create("Selm Arvid")])], [extract])
        self.assertIsNone(metrics["micro"])
        self.assertEqual(metrics["falsePositives"]["figure"], 1)

    def test_spread_over_repeats(self):
        self.assertEqual(
            gm.spread([0.5, 1.0, None]),
            {"mean": 0.75, "sd": 0.125**0.5, "min": 0.5, "max": 1.0, "n": 2},
        )
        self.assertIsNone(gm.spread([1.0])["sd"])


if __name__ == "__main__":
    unittest.main()
