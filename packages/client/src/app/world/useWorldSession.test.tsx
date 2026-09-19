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

  it("opens the newly owned imported project without replacing or reopening another world", async () => {
    const imported = { ...firstWorld, id: "new-owned-id", title: "Importierte Welt" };
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [firstWorld, imported],
    });
    const open = vi.spyOn(quiltorClient.application.worlds, "open");
    const select = vi.spyOn(quiltorClient.application.worlds, "select");
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue({ chapters: [] });
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue({
      nodes: [],
      edges: [],
    });
    vi.spyOn(quiltorClient.application.storyboards, "load").mockResolvedValue({
      boards: [],
      nodes: [],
      edges: [],
    });
    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([firstWorld, imported]));

    await act(() => result.current.projectImported(imported));

    expect(open).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith("new-owned-id");
    expect(result.current.world).toEqual(imported);
    expect(onDocumentsLoaded).toHaveBeenCalledOnce();
  });

  it("loads trash and refreshes both catalogs after restore", async () => {
    const trashed = { ...firstWorld, deletedAt: "2026-08-24T12:00:00.000Z" };
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [firstWorld],
    });
    vi.spyOn(quiltorClient.application.worlds, "listTrash")
      .mockResolvedValueOnce({ ok: true, worlds: [trashed] })
      .mockResolvedValueOnce({ ok: true, worlds: [] });
    const restore = vi
      .spyOn(quiltorClient.application.worlds, "restore")
      .mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useWorldSession(vi.fn()));
    await waitFor(() => expect(result.current.worlds).toEqual([firstWorld]));
    await act(() => result.current.loadTrash());
    expect(result.current.trash).toEqual([trashed]);

    await act(() => result.current.restore(firstWorld.id));
    expect(restore).toHaveBeenCalledWith(firstWorld.id);
    expect(result.current.trash).toEqual([]);
    expect(result.current.worlds).toEqual([firstWorld]);
  });

  it("keeps trash visible and reports purge failures", async () => {
    const trashed = { ...firstWorld, deletedAt: "2026-08-24T12:00:00.000Z" };
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({ ok: true, worlds: [] });
    vi.spyOn(quiltorClient.application.worlds, "listTrash").mockResolvedValue({
      ok: true,
      worlds: [trashed],
    });
    vi.spyOn(quiltorClient.application.worlds, "purge").mockRejectedValue(new Error("blocked"));

    const { result } = renderHook(() => useWorldSession(vi.fn()));
    await waitFor(() => expect(result.current.worlds).toEqual([]));
    await act(() => result.current.loadTrash());
    await act(async () => {
      await expect(result.current.purge(firstWorld.id)).rejects.toThrow("blocked");
    });

    expect(result.current.trash).toEqual([trashed]);
    expect(result.current.trashError).toBeTruthy();
  });
});
