import { describe, expect, it } from "vitest";
import { minimapColorForKind } from "./FigureNode";

describe("figure minimap colors", () => {
  it("keeps every element kind visually distinguishable", () => {
    expect(minimapColorForKind("person")).toBe("var(--minimap-person)");
    expect(minimapColorForKind("ort")).toBe("var(--minimap-place)");
    expect(minimapColorForKind("konzept")).toBe("var(--minimap-concept)");
    expect(minimapColorForKind("tier")).toBe("var(--minimap-animal)");
    expect(minimapColorForKind("organisation")).toBe("var(--minimap-organisation)");
    expect(minimapColorForKind("objekt")).toBe("var(--minimap-object)");
  });
});
