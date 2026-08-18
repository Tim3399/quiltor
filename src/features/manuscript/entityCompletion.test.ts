import { describe, expect, it } from "vitest";
import { entityCompletion, foldName, nameDistance } from "./entityCompletion";
import type { FigureNode } from "../../types";

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
  it("finds the name behind a transposition", () => {
    expect(suggest("Tarke", ["Tarek", "Mara"])).toBe("Tarek");
    expect(suggest("Taerk", ["Tarek", "Mara"])).toBe("Tarek");
  });

  it("finds the name behind a doubled and behind a missing letter", () => {
    expect(suggest("Tarrek", ["Tarek"])).toBe("Tarek");
    expect(suggest("Trek", ["Tarek"])).toBeNull(); // four characters: no budget, see below
    expect(suggest("Halvr", ["Halvar"])).toBe("Halvar");
  });

  it("reaches an umlaut and an ß from the keys that were pressed", () => {
    expect(suggest("Muller", ["Müller"])).toBe("Müller");
    expect(suggest("Mueller", ["Müller"])).toBe("Müller");
    expect(suggest("Strassen", ["Straßental"])).toBe("Straßental");
    expect(suggest("Ubermann", ["Übermann"])).toBe("Übermann");
  });

  it("allows a second edit only from ten characters on, and never a third", () => {
    expect(suggest("Winterhalter", ["Wintarhaltar"])).toBe("Wintarhaltar");
    expect(suggest("Wintarhaltar", ["Winterhelter"])).toBeNull();
    expect(suggest("Kastalen", ["Kastellan"])).toBeNull(); // eight characters, two edits
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
  });

  it("never repairs the first letter", () => {
    expect(suggest("Darek", ["Tarek"])).toBeNull();
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
  it("folds case, umlauts and ß", () => {
    expect(foldName("Müller")).toBe("muller");
    expect(foldName("Straße")).toBe("strasse");
    expect(foldName("Étienne")).toBe("etienne");
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
