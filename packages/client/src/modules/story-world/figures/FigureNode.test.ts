import { describe, expect, it } from "vitest";
import { minimapColorForKind } from "./FigureNode";

describe("figure minimap colors", () => {
  it("keeps every element kind visually distinguishable", () => {
    expect(minimapColorForKind("person")).toBe("var(--card-kind-person)");
    expect(minimapColorForKind("ort")).toBe("var(--card-kind-ort)");
    expect(minimapColorForKind("konzept")).toBe("var(--card-kind-konzept)");
    expect(minimapColorForKind("tier")).toBe("var(--card-kind-tier)");
    expect(minimapColorForKind("organisation")).toBe("var(--card-kind-organisation)");
    expect(minimapColorForKind("objekt")).toBe("var(--card-kind-objekt)");
  });
});
