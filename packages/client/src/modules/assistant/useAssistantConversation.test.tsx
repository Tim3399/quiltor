import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quiltorClient } from "../../platform";
import type { AssistantProposal } from "./model";
import type { FigureState } from "../story-world";
import { applyAssistantProposalsWithResult, scopeAssistantProposals } from "./proposals";
import { useAssistantConversation } from "./useAssistantConversation";

afterEach(() => vi.restoreAllMocks());

describe("assistant proposal acceptance", () => {
  it("can retry a relationship group after accepting its endpoints in another group", async () => {
    const proposals = scopeAssistantProposals(
      [
        { kind: "create_element", tempId: "new:a", element: { name: "Ada" } },
        { kind: "create_element", tempId: "new:b", element: { name: "Bela" } },
        { kind: "create_relationship", relationship: { from: "new:a", to: "new:b" } },
      ],
      "reply",
    );
    vi.spyOn(quiltorClient.platform.preferences, "get").mockReturnValue(
      JSON.stringify([
        { id: "entry", question: "Create related figures", applied: [], reply: { proposals } },
      ]),
    );
    vi.spyOn(quiltorClient.platform.preferences, "set").mockImplementation(() => {});
    let state: FigureState = { nodes: [], edges: [] };
    const { result } = renderHook(() =>
      useAssistantConversation({
        worldId: "review-fixture",
        forcedChapterIds: [],
        onApply: (selected) => {
          const outcome = applyAssistantProposalsWithResult(state, selected, (key) => key);
          state = outcome.state;
          return outcome;
        },
        onBeforeSend: async () => {},
        t: (key) => key,
      }),
    );
    await act(async () => result.current.apply("entry", [proposals[2]], [2]));
    expect(result.current.entries[0].applied).toEqual([]);
    expect(result.current.entries[0].proposalErrors).toEqual({ 2: "missing_element" });
    expect(state.nodes).toHaveLength(0);
    await act(async () => result.current.apply("entry", proposals.slice(0, 2), [0, 1]));
    await act(async () => result.current.apply("entry", [proposals[2]], [2]));
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(result.current.entries[0].applied).toEqual([0, 1, 2]);
    expect(result.current.entries[0].proposalErrors).toEqual({});
  });
  it("keeps skipped dependencies reviewable and records successful retries only", async () => {
    const proposal: AssistantProposal = {
      kind: "create_relationship",
      relationship: { from: "new:a", to: "new:b" },
    };
    vi.spyOn(quiltorClient.platform.preferences, "get").mockReturnValue(
      JSON.stringify([
        {
          id: "entry",
          question: "Connect the new elements",
          applied: [],
          reply: { proposals: [proposal] },
        },
      ]),
    );
    vi.spyOn(quiltorClient.platform.preferences, "set").mockImplementation(() => {});
    const onApply = vi
      .fn()
      .mockReturnValueOnce({
        appliedIndices: [],
        skipped: [{ index: 0, reason: "missing_element" }],
      })
      .mockReturnValueOnce({ appliedIndices: [0], skipped: [] });
    const { result } = renderHook(() =>
      useAssistantConversation({
        worldId: "review-fixture",
        forcedChapterIds: [],
        onApply,
        onBeforeSend: async () => {},
        t: (key) => key,
      }),
    );
    await act(async () => result.current.apply("entry", [proposal], [0]));
    expect(result.current.entries[0].applied).toEqual([]);
    await act(async () => result.current.apply("entry", [proposal], [0]));
    expect(result.current.entries[0].applied).toEqual([0]);
    expect(onApply).toHaveBeenCalledTimes(2);
    await act(async () => result.current.apply("entry", [proposal], [0]));
    expect(onApply).toHaveBeenCalledTimes(2);
  });
});
