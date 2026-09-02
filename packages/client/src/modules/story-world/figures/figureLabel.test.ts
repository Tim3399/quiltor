import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MessageKey } from "../../../i18n";
import type { FigureKind, FigureNode } from "../model";
import { authoredFigureLabel, figureDisplayLabel } from "./figureLabel";

const GERMAN: Partial<Record<MessageKey, string>> = {
  figure: "Figur",
  animal: "Tier",
  place: "Ort",
  organisation: "Organisation",
  object: "Objekt",
  concept: "Konzept",
};

const t = (key: MessageKey) => GERMAN[key] ?? key;

function figure(type: FigureKind, label?: string): Pick<FigureNode, "type" | "label"> {
  return { type, ...(label === undefined ? {} : { label }) };
}

describe("figure display labels", () => {
  it("lets an authored role stand in for the kind, whatever the kind is", () => {
    expect(figureDisplayLabel(figure("person", "Protagonistin"), t)).toBe("Protagonistin");
    expect(figureDisplayLabel(figure("tier", "Begleittier"), t)).toBe("Begleittier");
    expect(figureDisplayLabel(figure("organisation", "Geheimdienst"), t)).toBe("Geheimdienst");
    expect(figureDisplayLabel(figure("objekt", "Erbstück"), t)).toBe("Erbstück");
    expect(figureDisplayLabel(figure("ort", "Hauptstadt"), t)).toBe("Hauptstadt");
    expect(figureDisplayLabel(figure("konzept", "Verbotene Magie"), t)).toBe("Verbotene Magie");
  });

  it("falls back to the kind when no role was written", () => {
    expect(figureDisplayLabel(figure("person"), t)).toBe("Figur");
    expect(figureDisplayLabel(figure("tier", ""), t)).toBe("Tier");
    expect(figureDisplayLabel(figure("organisation", "   "), t)).toBe("Organisation");
    expect(figureDisplayLabel(figure("objekt"), t)).toBe("Objekt");
  });

  it("reads the captions old worlds were born with as no role at all", () => {
    expect(figureDisplayLabel(figure("person", "Rolle"), t)).toBe("Figur");
    expect(figureDisplayLabel(figure("person", "Role"), t)).toBe("Figur");
    expect(figureDisplayLabel(figure("tier", "Art / Rolle"), t)).toBe("Tier");
    expect(figureDisplayLabel(figure("tier", "Kind / role"), t)).toBe("Tier");
    expect(figureDisplayLabel(figure("organisation", "Art / Funktion"), t)).toBe("Organisation");
    expect(figureDisplayLabel(figure("objekt", "Kind / meaning"), t)).toBe("Objekt");
    expect(figureDisplayLabel(figure("ort", "Ort"), t)).toBe("Ort");
    expect(figureDisplayLabel(figure("konzept", "Concept"), t)).toBe("Konzept");
  });

  it("only forgives the caption the kind itself once produced", () => {
    // An animal an author actually called "Rolle" keeps it: that string was
    // never what a fresh animal was born with.
    expect(figureDisplayLabel(figure("tier", "Rolle"), t)).toBe("Rolle");
    expect(figureDisplayLabel(figure("person", "Art / Rolle"), t)).toBe("Art / Rolle");
    expect(figureDisplayLabel(figure("objekt", "Ort"), t)).toBe("Ort");
  });

  it("keeps an authored role through a change of kind", () => {
    const written = figure("person", "Protagonistin");
    expect(figureDisplayLabel({ ...written, type: "konzept" }, t)).toBe("Protagonistin");
  });

  it("reports an authored role separately from the fallback", () => {
    expect(authoredFigureLabel(figure("tier", "Begleittier"))).toBe("Begleittier");
    expect(authoredFigureLabel(figure("tier", "  Begleittier  "))).toBe("Begleittier");
    expect(authoredFigureLabel(figure("tier", "Art / Rolle"))).toBe("");
    expect(authoredFigureLabel(figure("tier"))).toBe("");
  });

  it("treats an element without a kind as a person, the way the card does", () => {
    expect(authoredFigureLabel({ label: "Rolle" })).toBe("");
    expect(figureDisplayLabel({ label: "" }, t)).toBe("Figur");
  });
});

describe("figure label ownership", () => {
  function source(path: string) {
    return readFileSync(join(process.cwd(), "packages/client/src", path), "utf8");
  }

  it("leaves the card one rule instead of a branch per kind", () => {
    const card = source("modules/story-world/figures/FigureNode.tsx");
    expect(card).toContain("figureDisplayLabel(item, t)");
    expect(card).not.toMatch(/item\.type !== "person"/);
  });

  it("never seeds a new element with a translated caption", () => {
    const canvas = source("modules/story-world/figures/useFigureCanvas.ts");
    expect(canvas).not.toContain("definition.nodeLabel");
    expect(source("modules/story-world/figures/figureTypes.ts")).not.toContain("nodeLabel");
  });
});
