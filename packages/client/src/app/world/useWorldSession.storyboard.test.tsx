import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultStoryboardState } from "../../modules/storyboard";
import { quiltorClient } from "../../platform";
import { useWorldSession } from "./useWorldSession";

const world = {
  id: "storyboard-world",
  title: "Storyboard-Welt",
  backupUrl: "",
  updated: "2026-08-30T12:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("useWorldSession Storyboard document", () => {
  it("loads the independent Storyboard document with the canonical documents", async () => {
    const manuscript = { chapters: [] };
    const figures = { nodes: [], edges: [] };
    const storyboards = createDefaultStoryboardState();
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [world],
    });
    vi.spyOn(quiltorClient.application.worlds, "open").mockResolvedValue({ ok: true, world });
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue(manuscript);
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue(figures);
    const loadStoryboards = vi
      .spyOn(quiltorClient.application.storyboards, "load")
      .mockResolvedValue(storyboards);

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([world]));
    await act(async () => result.current.open(world.id));

    expect(loadStoryboards).toHaveBeenCalledOnce();
    expect(onDocumentsLoaded).toHaveBeenCalledWith({
      manuscript,
      figures,
      storyboards,
      orphanedMentions: 0,
    });
    expect(result.current.world).toEqual(world);
  });

  it("does not open a partially loaded world when Storyboard loading fails", async () => {
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [world],
    });
    vi.spyOn(quiltorClient.application.worlds, "open").mockResolvedValue({ ok: true, world });
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue({ chapters: [] });
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue({
      nodes: [],
      edges: [],
    });
    vi.spyOn(quiltorClient.application.storyboards, "load").mockRejectedValue(
      new Error("Storyboard nicht erreichbar"),
    );

    const onDocumentsLoaded = vi.fn();
    const { result } = renderHook(() => useWorldSession(onDocumentsLoaded));
    await waitFor(() => expect(result.current.worlds).toEqual([world]));
    await act(async () => result.current.open(world.id));

    expect(onDocumentsLoaded).not.toHaveBeenCalled();
    expect(result.current.world).toBeNull();
    expect(result.current.loadError).toContain("Storyboard nicht erreichbar");
  });
});
