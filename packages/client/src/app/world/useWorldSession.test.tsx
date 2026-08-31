import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quiltorClient } from "../../platform";
import { useWorldSession } from "./useWorldSession";

const firstWorld = {
  id: "world-a",
  title: "Welt A",
  backupUrl: "",
  updated: "2026-08-23T12:00:00.000Z",
};
const refreshedWorld = {
  ...firstWorld,
  updated: "2026-08-23T12:30:00.000Z",
};

describe("useWorldSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
  });

  it("returns to the refreshed world selection without reloading the page", async () => {
    const select = vi.spyOn(quiltorClient.application.worlds, "select");
    vi.spyOn(quiltorClient.application.worlds, "list")
      .mockResolvedValueOnce({ ok: true, worlds: [firstWorld] })
      .mockResolvedValueOnce({ ok: true, worlds: [refreshedWorld] });
    vi.spyOn(quiltorClient.application.worlds, "open").mockResolvedValue({
      ok: true,
      world: firstWorld,
    });
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue({ chapters: [] });
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue({
      nodes: [],
      edges: [],
    });
    vi.spyOn(quiltorClient.application.storyboards, "load").mockResolvedValue({
      boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
      nodes: [],
      edges: [],
    });

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([firstWorld]));
    await act(async () => result.current.open(firstWorld.id));
    expect(result.current.world).toEqual(firstWorld);
    expect(onDocumentsLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        storyboards: expect.objectContaining({
          boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
        }),
      }),
    );

    history.replaceState(null, "", "/?view=board&world=world-a#top");
    act(() => result.current.close());

    expect(result.current.world).toBeNull();
    expect(select).toHaveBeenLastCalledWith("");
    expect(location.search).toBe("?view=board");
    expect(location.hash).toBe("#top");
    await waitFor(() => expect(result.current.worlds).toEqual([refreshedWorld]));
  });
});
