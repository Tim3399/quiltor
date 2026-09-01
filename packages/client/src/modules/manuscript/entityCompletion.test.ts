import { describe, expect, it } from "vitest";
import type { FigureNode } from "../story-world";
import { entityCompletion, foldCompletionName, foldName, nameDistance } from "./entityCompletion";

const figure = (name: string, id = name.toLowerCase()): FigureNode => ({
  id,
  x: 0,
  y: 0,
  type: "person",
  name,
});

function suggest(typed: string, names: string[], vocabulary: string[] = []) {
  return (
    entityCompletion(
      `Sie sah ${typed}`,
      `Sie sah ${typed}`.length,
      names.map((name) => figure(name)),
      vocabulary,
    )?.word ?? null
  );
}

describe("name completion, deterministic first", () => {
  it("completes a prefix that is typed correctly, from two characters on", () => {
    expect(suggest("Tar", ["Tarek", "Mara"])).toBe("Tarek");
    expect(suggest("Ta", ["Tarek", "Tanja"])).toBe("Tanja");
  });

  it("lets the exact prefix win over a name a fuzzy match would also reach", () => {
    // "Tareki" starts with what was typed, "Tarek" is one edit away from it. The deterministic
    // match answers alone -- the fuzzy candidate never makes it ambiguous.
    expect(suggest("Tarek", ["Tareki", "Tarel"])).toBe("Tareki");
  });

  it("treats accents and ph/f as deterministic spelling variants", () => {
    expect(suggest("Se", ["Séraphine"])).toBe("Séraphine");
    expect(suggest("Seraf", ["Séraphine"])).toBe("Séraphine");
    expect(suggest("Seraphine", ["Séraphine"])).toBe("Séraphine");
  });

  it("does not let spelling folds turn a short input into a one-letter guess", () => {
    expect(suggest("Ph", ["Fara"])).toBeNull();
    expect(suggest("Pha", ["Fara"])).toBe("Fara");
  });

  it("keeps a literal prefix ahead of a folded spelling variant", () => {
    expect(suggest("Sera", ["Séraphine", "Serafina"])).toBe("Serafina");
  });

  it("stays silent when multiple names share the folded prefix", () => {
    expect(suggest("Se", ["Séraphine", "Sèlene"])).toBeNull();
  });

  it("protects known vocabulary before considering a folded prefix", () => {
    expect(suggest("Serafine", ["Séraphine"], ["Serafine"])).toBeNull();
  });

  it("recognizes decomposed Unicode accents as part of the word", () => {
    expect(suggest("Se\u0301raf", ["Séraphine"])).toBe("Séraphine");
  });

  it("says nothing when two figures carry the same name", () => {
    const entities = [figure("Mara", "a"), figure("Mara", "b")];
    expect(entityCompletion("Ma", 2, entities)).toBeNull();
  });

  it("does not complete a name that is already fully typed", () => {
    expect(suggest("Tarek", ["Tarek"])).toBeNull();
    expect(suggest("tarek", ["Tarek"])).toBeNull();
  });

  it("reports where the word has to be replaced", () => {
    const match = entityCompletion("Sie sah Tarke", 13, [figure("Tarek")]);
    expect(match).toMatchObject({ word: "Tarek", start: 8, end: 13 });
    expect(match?.entity.id).toBe("tarek");
  });
});

describe("name completion, one edit per five characters", () => {
  it("recognizes one typo in an unfinished literal prefix before phonetic folding", () => {
    // `Serapgi` differs from the unfinished prefix `Seraphi` in one of seven typed letters.
    // Comparing only the `ph` -> `f` folded forms would incorrectly turn that into several edits.
    expect(suggest("Serapgi", ["Seraphine"])).toBe("Seraphine");
    expect(suggest("serapgi", ["Seraphine"])).toBe("Seraphine");
    expect(suggest("SERAPGI", ["Seraphine"])).toBe("Seraphine");
    expect(suggest("Serapgi", ["Séraphine"])).toBe("Séraphine");
  });

  it("derives the edit budget from ten typed characters before ph folding", () => {
    const typed = "Seraphinus";
    const twoOfTenEdits = "Serophinas";
    const threeOfTenEdits = "Sorophinas";

    expect(typed).toHaveLength(10);
    expect(twoOfTenEdits).toHaveLength(10);
    expect(threeOfTenEdits).toHaveLength(10);
    expect(nameDistance(foldName(typed), foldName(twoOfTenEdits), 2)).toBe(2);
    expect(nameDistance(foldName(typed), foldName(threeOfTenEdits), 3)).toBe(3);
    expect(suggest(typed, [twoOfTenEdits])).toBe(twoOfTenEdits);
    expect(suggest(typed, [threeOfTenEdits])).toBeNull();
  });

  it("finds the name behind a transposition", () => {
    expect(suggest("Tarke", ["Tarek", "Mara"])).toBe("Tarek");
    expect(suggest("Taerk", ["Tarek", "Mara"])).toBe("Tarek");
  });

  it("finds the name behind a doubled and behind a missing letter", () => {
    expect(suggest("Tarrek", ["Tarek"])).toBe("Tarek");
    expect(suggest("Trek", ["Tarek"])).toBeNull(); // four characters: no budget, see below
    expect(suggest("Halvr", ["Halvar"])).toBe("Halvar");
  });

  it("folds accents before applying the same conservative edit budget", () => {
    expect(suggest("Muller", ["Müller"])).toBe("Müller");
    expect(suggest("Mueller", ["Müller"])).toBe("Müller");
    expect(suggest("Strassen", ["Straßental"])).toBeNull();
    expect(suggest("Ubermann", ["Übermann"])).toBe("Übermann");
  });

  it("allows one edit for every five folded characters", () => {
    expect(suggest("Winterhalter", ["Wintarhaltar"])).toBe("Wintarhaltar");
    expect(suggest("Wintarhaltar", ["Winterhelter"])).toBeNull();
    expect(suggest("Kastalen", ["Kastellan"])).toBeNull(); // eight characters, two edits

    const typed = "Abcdefghijklmno";
    const name = Array.from(typed);
    name[4] = "x";
    name[9] = "y";
    name[14] = "z";
    const threeEdits = name.join("");
    expect(suggest(typed, [threeEdits])).toBe(threeEdits);
  });
});

describe("name completion, silence is the cheaper answer", () => {
  it("says nothing when two names are equally close", () => {
    expect(suggest("Halver", ["Halvar", "Halvor"])).toBeNull();
    expect(suggest("Marek", ["Marec", "Marev"])).toBeNull();
  });

  it("still answers when one of the two is clearly closer", () => {
    expect(suggest("Kastelan", ["Kastellan", "Kestellon"])).toBe("Kastellan");
  });

  it("guesses nothing below five typed characters", () => {
    // At four characters one edit is a quarter of the word and nearly every short beginning is
    // one edit from every name -- and Tab would accept the guess over what was typed.
    expect(suggest("Trak", ["Tarek"])).toBeNull();
    expect(suggest("Mra", ["Mara"])).toBeNull();
    expect(suggest("Serg", ["Seraphine"])).toBeNull();
  });

  it("does not stretch an unfinished-prefix match to a distant name", () => {
    expect(suggest("Saxpgzi", ["Seraphine"])).toBeNull();
    expect(suggest("Serapgi", ["Seraglio", "Mara"])).toBeNull();
  });

  it("ranks literal prefixes before spelling variants and spelling variants before fuzzy ones", () => {
    expect(suggest("Serap", ["Seraphina", "Séraphine", "Seraglio"])).toBe("Seraphina");
    expect(suggest("Serafi", ["Séraphine", "Seraglio"])).toBe("Séraphine");
    expect(suggest("Serapgi", ["Seraphine", "Seraglio"])).toBe("Seraphine");
  });

  it("repairs the first letter when the name still meets the 80 percent threshold", () => {
    expect(suggest("Darek", ["Tarek"])).toBe("Tarek");
  });

  it("leaves an ordinary German word alone", () => {
    expect(suggest("Fenster", ["Tarek", "Müller", "Halvar"])).toBeNull();
    expect(suggest("gestern", ["Gerstner"])).toBeNull();
    // "Wagen" is one edit from "Wagner". A term the manuscript already knows is a word the writer
    // meant, so it is not corrected into a name.
    expect(suggest("Wagen", ["Wagner"], ["Wagen"])).toBeNull();
    // Without that term the guard has nothing to go on: this is the known gap of the feature.
    expect(suggest("Wagen", ["Wagner"])).toBe("Wagner");
  });
});

describe("name comparison", () => {
  it("folds case, accents, and the ph/f spelling pair", () => {
    expect(foldName("Müller")).toBe("müller");
    expect(foldCompletionName("Müller")).toBe("muller");
    expect(foldCompletionName("Straße")).toBe("straße");
    expect(foldCompletionName("Étienne")).toBe("etienne");
    expect(foldCompletionName("Seraphine")).toBe("serafine");
    expect(foldCompletionName("Serafine")).toBe("serafine");
    expect(foldCompletionName("Séraphine")).toBe("serafine");
  });

  it("measures against every prefix of the name, so the untyped tail costs nothing", () => {
    expect(nameDistance("tar", "tarek", 1)).toBe(0);
    expect(nameDistance("tarke", "tarek", 1)).toBe(1);
    expect(nameDistance("tarrek", "tarek", 1)).toBe(1);
  });

  it("gives up at the budget instead of scoring the whole name", () => {
    expect(nameDistance("fenster", "tarek", 1)).toBeGreaterThan(1);
    expect(nameDistance("fenster", "tarek", 2)).toBeGreaterThan(2);
    expect(nameDistance("tarek", "ta", 1)).toBeGreaterThan(1);
  });
});
