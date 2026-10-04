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
const secondWorld = {
  ...firstWorld,
  id: "world-b",
  title: "Welt B",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const manuscript = (title: string) => ({
  chapters: [{ id: `chapter-${title}`, title, body: "", note: "" }],
});
const figures = { nodes: [], edges: [] };
const storyboards = { boards: [], nodes: [], edges: [] };

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

  it("publishes only the newest overlapping world load and ignores a closed load failure", async () => {
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [firstWorld, secondWorld],
    });
    vi.spyOn(quiltorClient.application.worlds, "open").mockImplementation(async (id) => ({
      ok: true,
      world: id === firstWorld.id ? firstWorld : secondWorld,
    }));
    const manuscriptA = deferred<ReturnType<typeof manuscript>>();
    const manuscriptB = deferred<ReturnType<typeof manuscript>>();
    const figuresA = deferred<typeof figures>();
    const figuresB = deferred<typeof figures>();
    const storyboardsA = deferred<typeof storyboards>();
    const storyboardsB = deferred<typeof storyboards>();
    vi.spyOn(quiltorClient.application.manuscript, "load")
      .mockReturnValueOnce(manuscriptA.promise)
      .mockReturnValueOnce(manuscriptB.promise);
    vi.spyOn(quiltorClient.application.storyWorld, "load")
      .mockReturnValueOnce(figuresA.promise)
      .mockReturnValueOnce(figuresB.promise);
    vi.spyOn(quiltorClient.application.storyboards, "load")
      .mockReturnValueOnce(storyboardsA.promise)
      .mockReturnValueOnce(storyboardsB.promise);

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([firstWorld, secondWorld]));

    let openingA!: Promise<void>;
    act(() => {
      openingA = result.current.open(firstWorld.id);
    });
    await waitFor(() => expect(quiltorClient.application.manuscript.load).toHaveBeenCalledOnce());
    let openingB!: Promise<void>;
    act(() => {
      openingB = result.current.open(secondWorld.id);
    });
    await waitFor(() => expect(quiltorClient.application.manuscript.load).toHaveBeenCalledTimes(2));
    await act(async () => {
      manuscriptB.resolve(manuscript("B"));
      figuresB.resolve(figures);
      storyboardsB.resolve(storyboards);
      await openingB;
    });
    expect(result.current.world).toEqual(secondWorld);
    expect(onDocumentsLoaded).toHaveBeenCalledOnce();
    expect(onDocumentsLoaded).toHaveBeenLastCalledWith(
      expect.objectContaining({
        manuscript: expect.objectContaining({
          chapters: [expect.objectContaining({ title: "B" })],
        }),
      }),
    );

    await act(async () => {
      manuscriptA.resolve(manuscript("A"));
      figuresA.resolve(figures);
      storyboardsA.resolve(storyboards);
      await openingA;
    });
    expect(result.current.world).toEqual(secondWorld);
    expect(onDocumentsLoaded).toHaveBeenCalledOnce();

    const closedManuscript = deferred<ReturnType<typeof manuscript>>();
    vi.mocked(quiltorClient.application.manuscript.load).mockReturnValueOnce(
      closedManuscript.promise,
    );
    vi.mocked(quiltorClient.application.storyWorld.load).mockResolvedValueOnce(figures);
    vi.mocked(quiltorClient.application.storyboards.load).mockResolvedValueOnce(storyboards);
    let openingClosed!: Promise<void>;
    act(() => {
      openingClosed = result.current.open(firstWorld.id);
    });
    await waitFor(() => expect(quiltorClient.application.manuscript.load).toHaveBeenCalledTimes(3));
    act(() => result.current.close());
    await act(async () => {
      closedManuscript.reject(new Error("late failure"));
      await openingClosed;
    });
    expect(result.current.world).toBeNull();
    expect(result.current.loadError).toBe("");
    expect(onDocumentsLoaded).toHaveBeenCalledOnce();
  });

  it("retries a created world's failed load without creating a duplicate", async () => {
    const created = { ...secondWorld, id: "created-world", title: "Neue Welt" };
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({ ok: true, worlds: [] });
    const create = vi
      .spyOn(quiltorClient.application.worlds, "create")
      .mockResolvedValue({ ok: true, world: created });
    const open = vi
      .spyOn(quiltorClient.application.worlds, "open")
      .mockResolvedValue({ ok: true, world: created });
    vi.spyOn(quiltorClient.application.manuscript, "load")
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(manuscript("Created"));
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue(figures);
    vi.spyOn(quiltorClient.application.storyboards, "load").mockResolvedValue(storyboards);

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([]));

    await act(async () => {
      await expect(result.current.create("Neue Welt", "remote")).rejects.toThrow("load failed");
    });
    expect(result.current.loadError).toBeTruthy();
    expect(result.current.world).toBeNull();

    await act(async () => result.current.create("Neue Welt", "remote"));
    expect(create).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(created.id);
    expect(result.current.world).toEqual(created);
    expect(onDocumentsLoaded).toHaveBeenCalledOnce();
  });

  it("does not retain a created world that resolves after the session closes", async () => {
    const created = { ...secondWorld, id: "stale-created", title: "Späte Welt" };
    const firstCreate = deferred<{ ok: boolean; world: typeof created }>();
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({ ok: true, worlds: [] });
    const create = vi
      .spyOn(quiltorClient.application.worlds, "create")
      .mockReturnValueOnce(firstCreate.promise)
      .mockResolvedValueOnce({ ok: true, world: created });
    const open = vi.spyOn(quiltorClient.application.worlds, "open");
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue(manuscript("Created"));
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue(figures);
    vi.spyOn(quiltorClient.application.storyboards, "load").mockResolvedValue(storyboards);

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([]));
    let creating!: Promise<void>;
    act(() => {
      creating = result.current.create("Späte Welt", "remote");
      result.current.close();
    });
    await act(async () => {
      firstCreate.resolve({ ok: true, world: created });
      await creating;
    });
    expect(result.current.world).toBeNull();
    expect(onDocumentsLoaded).not.toHaveBeenCalled();

    await act(async () => result.current.create("Späte Welt", "remote"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    expect(result.current.world).toEqual(created);
  });

  it("does not revive a requested URL world after the initial catalog load is superseded", async () => {
    history.replaceState(null, "", `/?world=${firstWorld.id}`);
    const initialList = deferred<{ ok: boolean; worlds: (typeof firstWorld)[] }>();
    vi.spyOn(quiltorClient.application.worlds, "list")
      .mockReturnValueOnce(initialList.promise)
      .mockResolvedValueOnce({ ok: true, worlds: [firstWorld] });
    const open = vi.spyOn(quiltorClient.application.worlds, "open");
    const onDocumentsLoaded = vi.fn();

    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    act(() => result.current.close());
    await act(async () => {
      initialList.resolve({ ok: true, worlds: [firstWorld] });
      await initialList.promise;
    });

    expect(open).not.toHaveBeenCalled();
    expect(result.current.world).toBeNull();
    expect(location.search).toBe("");
  });

  it("does not publish an initial catalog error after a newer session action", async () => {
    const initialList = deferred<{ ok: boolean; worlds: (typeof firstWorld)[] }>();
    vi.spyOn(quiltorClient.application.worlds, "list")
      .mockReturnValueOnce(initialList.promise)
      .mockResolvedValueOnce({ ok: true, worlds: [firstWorld] });
    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));

    act(() => result.current.close());
    await act(async () => {
      initialList.reject(new Error("stale catalog failure"));
      await initialList.promise.catch(() => undefined);
    });

    expect(result.current.loadError).toBe("");
    expect(result.current.world).toBeNull();
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
