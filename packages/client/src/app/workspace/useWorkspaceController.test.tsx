import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useWorkspaceController } from "./useWorkspaceController";

afterEach(cleanup);

describe("useWorkspaceController", () => {
  it("clears an old text destination when selecting workspaces normally", () => {
    const { result } = renderHook(() => useWorkspaceController());
    act(() => result.current.navigate({ workspace: "text", id: "c2" }));
    act(() => result.current.selectWorkspace("figures"));
    expect(result.current.target).toBeNull();
    act(() => result.current.selectWorkspace("text"));
    expect(result.current.workspace).toBe("text");
    expect(result.current.target).toBeNull();
  });

  it.each(["text", "figures", "timeline", "places", "storyboard", "focus"])(
    "clears an old destination for the %s command",
    (command) => {
      const { result } = renderHook(() => useWorkspaceController());
      act(() => result.current.navigate({ workspace: "text", id: "c2" }));
      act(() => expect(result.current.execute(command)).toBe(true));
      expect(result.current.target).toBeNull();
    },
  );

  it("gives every navigation to the same target a fresh request identity", () => {
    const { result } = renderHook(() => useWorkspaceController());

    act(() => result.current.navigate({ workspace: "places", id: "harbour" }));
    const firstRequestId = result.current.target?.requestId;
    expect(result.current.target).toMatchObject({ workspace: "places", id: "harbour" });

    act(() => result.current.navigate({ workspace: "places", id: "harbour" }));
    expect(result.current.target).toMatchObject({ workspace: "places", id: "harbour" });
    expect(result.current.target?.requestId).toBeGreaterThan(firstRequestId ?? 0);

    const secondRequestId = result.current.target?.requestId;
    act(() => result.current.setTarget({ workspace: "places", id: "harbour" }));
    expect(result.current.target?.requestId).toBeGreaterThan(secondRequestId ?? 0);
  });

  it("selects the storyboard from workspace commands", () => {
    const { result } = renderHook(() => useWorkspaceController());

    act(() => expect(result.current.execute("storyboard")).toBe(true));

    expect(result.current.workspace).toBe("storyboard");
    expect(result.current.focus).toBe(false);
  });
});
