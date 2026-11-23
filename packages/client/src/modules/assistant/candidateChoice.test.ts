import { describe, expect, it } from "vitest";
import {
  CREATE_NEW,
  candidateBlock,
  chosenElements,
  resolvedToExisting,
  withChosenElements,
} from "./candidateChoice";
import type { AssistantProposal, AssistantReply } from "./model";

const AMBIGUOUS: AssistantProposal = {
  kind: "create_element",
  tempId: "new:e1:brandt",
  element: { type: "person", name: "Herr Brandt" },
};
const PLAIN: AssistantProposal = {
  kind: "create_element",
  tempId: "new:e1:ilka",
  element: { type: "person", name: "Ilka Kornatz" },
};
const DEPENDENT: AssistantProposal = {
  kind: "create_relationship",
  relationship: {
    from: "new:e1:brandt",
    to: "x-wenke",
    label: "verwaltet",
    directed: true,
    lineStyle: "solid",
    relationshipKind: "general",
    color: "auto",
  },
} as AssistantProposal;

function reply(): AssistantReply {
  return {
    ok: true,
    message: "",
    citations: [],
    sources: [],
    mode: "world_extraction",
    proposals: [PLAIN, AMBIGUOUS, DEPENDENT],
    proposalEnvelopes: [
      { proposal: PLAIN, evidence: [] },
      {
        proposal: AMBIGUOUS,
        evidence: [],
        resolution: {
          operation: "element",
          outcome: "ambiguous",
          status: "ambiguous",
          resolvedId: null,
          candidateIds: ["oda", "x-karl"],
          candidates: [
            { id: "oda", name: "Oda Brandt", kind: "person" },
            { id: "x-karl", name: "Karl Brandt", kind: "person" },
          ],
        },
      },
      { proposal: DEPENDENT, evidence: [] },
    ],
  } as AssistantReply;
}

describe("candidate choice (T-344)", () => {
  it("holds back the ambiguous proposal and what hangs on it until the author chooses", () => {
    expect(candidateBlock(reply(), {}, 0)).toBeNull();
    expect(candidateBlock(reply(), {}, 1)).toBe("choose");
    expect(candidateBlock(reply(), {}, 2)).toBe("dependent");
    expect(candidateBlock(reply(), { 1: "oda" }, 1)).toBeNull();
    expect(candidateBlock(reply(), { 1: "oda" }, 2)).toBeNull();
  });

  it("points what hangs on a chosen candidate at that element and creates nothing", () => {
    const choices = { 1: "oda" };
    const chosen = chosenElements(reply(), choices);
    expect(resolvedToExisting(reply(), choices, 1)).toBe(true);
    const rewritten = withChosenElements(DEPENDENT, chosen);
    expect(rewritten).toMatchObject({ relationship: { from: "oda", to: "x-wenke" } });
  });

  it("creates the element when the author chooses a new one", () => {
    const choices = { 1: CREATE_NEW };
    expect(resolvedToExisting(reply(), choices, 1)).toBe(false);
    expect(chosenElements(reply(), choices).size).toBe(0);
    expect(withChosenElements(DEPENDENT, chosenElements(reply(), choices))).toEqual(DEPENDENT);
  });
});
