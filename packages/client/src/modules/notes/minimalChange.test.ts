import { describe, expect, it } from "vitest";
import { minimalChange } from "./ReferenceTextEditor";

const apply = (text: string, change: ReturnType<typeof minimalChange>) =>
  text.slice(0, change.from) + change.insert + text.slice(change.to);

describe("minimalChange (T-177)", () => {
  it.each([
    ["Eins.", "Eins. Zwei."],
    ["Eins. Zwei.", "Eins."],
    ["Hafen", "Hafen"],
    ["", "Neu"],
    ["Alt", ""],
    ["aXb", "aYb"],
    ["abab", "ab"],
    ["😀 Hafen", "😃 Hafen"],
    ["Hafen 😀", "Hafen 😃"],
    ["x😀y", "x😀😀y"],
  ])("turns %j into %j and nothing more", (current, next) => {
    const change = minimalChange(current, next);
    expect(apply(current, change)).toBe(next);
    expect(change.to - change.from).toBeLessThanOrEqual(current.length);
  });

  it("touches only the edited range", () => {
    expect(minimalChange("Eins. Zwei.", "Eins. Drei.")).toEqual({ from: 6, to: 8, insert: "Dr" });
  });

  it("never splits a surrogate pair", () => {
    const change = minimalChange("😀", "😃");
    expect(change).toEqual({ from: 0, to: 2, insert: "😃" });
  });
});
