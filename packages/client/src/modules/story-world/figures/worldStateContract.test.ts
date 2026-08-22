import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FigureState } from "../model";
import { resolvePresence } from "./presence";
import { figureIsDeceased, resolveRelationship } from "./relationships";

interface Check {
  momentId: string;
  adaAlive: boolean;
  adaLocation: string;
  benLocation: string;
  relationshipActive: boolean;
  relationshipLabel: string;
  relationshipFrom: string;
  relationshipDirected: boolean;
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "contracts/fixtures/story-world/world-state.v1.json"), "utf8"),
) as { figures: FigureState; checks: Check[] };

describe("WorldState cross-language contract", () => {
  it("keeps frontend projections aligned with the canonical backend fixture", () => {
    const { nodes, edges, timeline = [], presence = [] } = fixture.figures;
    const ada = nodes.find((node) => node.id === "ada")!;
    const bond = edges.find((edge) => edge.id === "bond")!;

    for (const check of fixture.checks) {
      const relationship = resolveRelationship(bond, timeline, check.momentId);
      expect(!figureIsDeceased(ada, timeline, check.momentId)).toBe(check.adaAlive);
      expect(resolvePresence("ada", presence, timeline, check.momentId)?.placeId ?? "unknown").toBe(
        check.adaLocation,
      );
      expect(resolvePresence("ben", presence, timeline, check.momentId)?.placeId ?? "unknown").toBe(
        check.benLocation,
      );
      expect(relationship.active).toBe(check.relationshipActive);
      expect(relationship.label).toBe(check.relationshipLabel);
      expect(relationship.from).toBe(check.relationshipFrom);
      expect(relationship.gerichtet ?? false).toBe(check.relationshipDirected);
    }
  });
});
