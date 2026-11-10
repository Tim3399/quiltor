import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDeterministicMentions,
  type Manuscript,
  normalizeMarks,
  reconcileMentions,
} from "../../modules/manuscript";
import type { FigureState, WorldInfo } from "../../modules/story-world";
import type { StoryboardState } from "../../modules/storyboard";
import { ApplicationGatewayError, applicationErrorMessage, quiltorClient } from "../../platform";

export type LoadedWorldDocuments = {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards: StoryboardState;
  orphanedMentions: number;
};

export type WorldLoadSource = "open" | "url" | "create" | "import";

/** The world selection a set of loaded documents belongs to. */
export type WorldBinding = { worldId: string; generation: number; source: WorldLoadSource };

export function useWorldSession(
  onDocumentsLoaded: (documents: LoadedWorldDocuments, binding: WorldBinding) => void,
) {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null);
  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [trash, setTrash] = useState<(WorldInfo & { deletedAt: string })[] | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [authError] = useState(() => new URLSearchParams(location.search).get("authError"));
  const [loadError, setLoadError] = useState("");
  const [trashError, setTrashError] = useState("");
  const [previewExpired, setPreviewExpired] = useState(false);
  const loadGeneration = useRef(0);
  // The open world, for leaving it: an unchanged preview is discarded on the way out.
  const openWorld = useRef<WorldInfo | null>(null);
  // Which world the HTTP gateway points at right now, and which load pointed it there.
  const selection = useRef({ worldId: "", generation: 0 });
  const pendingCreatedWorld = useRef<{
    world: WorldInfo;
    title: string;
    backupUrl: string;
  } | null>(null);

  const loadWorld = useCallback(
    async (
      selected: Promise<{ ok: boolean; world: WorldInfo }>,
      generation: number,
      source: WorldLoadSource,
      rejectOnFailure = false,
      onSelected?: (world: WorldInfo) => void,
    ): Promise<boolean> => {
      try {
        const result = await selected;
        if (generation !== loadGeneration.current) return false;
        onSelected?.(result.world);
        quiltorClient.application.worlds.select(result.world.id);
        selection.current = { worldId: result.world.id, generation };
        const [manuscript, figures, storyboards] = await Promise.all([
          quiltorClient.application.manuscript.load(),
          quiltorClient.application.storyWorld.load(),
          quiltorClient.application.storyboards.load(),
        ]);
        if (generation !== loadGeneration.current) return false;
        const reconciled = reconcileMentions(manuscript, figures.nodes);
        const linked: Manuscript = {
          ...reconciled.manuscript,
          chapters: reconciled.manuscript.chapters.map((chapter) => ({
            ...chapter,
            mentions: addDeterministicMentions(chapter.body, chapter.mentions || [], figures.nodes),
            ...(chapter.marks ? { marks: normalizeMarks(chapter.marks, chapter.body.length) } : {}),
          })),
        };
        onDocumentsLoaded(
          {
            manuscript: linked,
            figures,
            storyboards,
            orphanedMentions: reconciled.orphanedCount,
          },
          { worldId: result.world.id, generation, source },
        );
        setWorld(result.world);
        openWorld.current = result.world;
        setPreviewExpired(false);
        return true;
      } catch (error) {
        if (generation !== loadGeneration.current) return false;
        setLoadError(applicationErrorMessage(error));
        if (rejectOnFailure) throw error;
        return false;
      }
    },
    [onDocumentsLoaded],
  );

  useEffect(() => {
    let active = true;
    const initialGeneration = loadGeneration.current;
    quiltorClient.application.worlds
      .list()
      .then((result) => {
        if (!active) return;
        setWorlds(result.worlds);
        const requested = new URLSearchParams(location.search).get("world");
        if (requested && loadGeneration.current === initialGeneration) {
          const generation = ++loadGeneration.current;
          pendingCreatedWorld.current = null;
          setLoadError("");
          void loadWorld(quiltorClient.application.worlds.open(requested), generation, "url");
        }
      })
      .catch((error) => {
        if (!active || loadGeneration.current !== initialGeneration) return;
        if (error instanceof ApplicationGatewayError && error.category === "unauthorized") {
          setNeedsSignIn(true);
          return;
        }
        setWorlds([]);
        setLoadError(applicationErrorMessage(error));
      });
    return () => {
      active = false;
      loadGeneration.current += 1;
      pendingCreatedWorld.current = null;
    };
  }, [loadWorld]);

  useEffect(() => {
    if (authError) history.replaceState(null, "", location.pathname);
  }, [authError]);

  // Closing the tab or reloading leaves an unchanged preview too. A reload returns to the
  // world list for every world, so nothing is lost; the request survives the page (keepalive).
  const previewId = world?.preview ? world.id : "";
  useEffect(() => {
    if (!previewId) return;
    const leave = () => quiltorClient.application.worlds.discardPreview(previewId);
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [previewId]);

  const open = useCallback(
    (id: string) => {
      const generation = ++loadGeneration.current;
      pendingCreatedWorld.current = null;
      setLoadError("");
      return loadWorld(quiltorClient.application.worlds.open(id), generation, "open").then(
        () => undefined,
      );
    },
    [loadWorld],
  );
  /** A fresh preview of the example world (T-214-5b); the server decides everything else. */
  const openExample = useCallback(
    (lang: string) => {
      const generation = ++loadGeneration.current;
      pendingCreatedWorld.current = null;
      setLoadError("");
      return loadWorld(quiltorClient.application.worlds.openExample(lang), generation, "open").then(
        () => undefined,
      );
    },
    [loadWorld],
  );
  /** The save that made the open preview real hands its world back: title and mark. */
  const adoptWorld = useCallback((adopted: WorldInfo) => {
    if (openWorld.current?.id !== adopted.id) return;
    openWorld.current = adopted;
    setWorld(adopted);
  }, []);
  const markPreviewExpired = useCallback(() => setPreviewExpired(true), []);
  const create = useCallback(
    async (title: string, backupUrl: string) => {
      const retry = pendingCreatedWorld.current;
      const reuse = retry?.title === title && retry.backupUrl === backupUrl;
      if (!reuse) pendingCreatedWorld.current = null;
      const generation = ++loadGeneration.current;
      setLoadError("");
      const loaded = await loadWorld(
        reuse
          ? quiltorClient.application.worlds.open(retry.world.id)
          : quiltorClient.application.worlds.create(title, backupUrl),
        generation,
        "create",
        true,
        (created) => {
          pendingCreatedWorld.current = { world: created, title, backupUrl };
        },
      );
      if (loaded && generation === loadGeneration.current) pendingCreatedWorld.current = null;
    },
    [loadWorld],
  );
  const remove = useCallback(async (id: string) => {
    setLoadError("");
    try {
      await quiltorClient.application.worlds.delete(id);
      const result = await quiltorClient.application.worlds.list();
      setWorlds(result.worlds);
      setTrash(null);
    } catch (error) {
      setLoadError(applicationErrorMessage(error));
      throw error;
    }
  }, []);
  const loadTrash = useCallback(async () => {
    setTrash(null);
    setTrashError("");
    try {
      const result = await quiltorClient.application.worlds.listTrash();
      setTrash(result.worlds);
    } catch (error) {
      setTrash([]);
      setTrashError(applicationErrorMessage(error));
    }
  }, []);
  const restore = useCallback(async (id: string) => {
    setTrashError("");
    try {
      await quiltorClient.application.worlds.restore(id);
      const [listed, trashed] = await Promise.all([
        quiltorClient.application.worlds.list(),
        quiltorClient.application.worlds.listTrash(),
      ]);
      setWorlds(listed.worlds);
      setTrash(trashed.worlds);
    } catch (error) {
      setTrashError(applicationErrorMessage(error));
      throw error;
    }
  }, []);
  const purge = useCallback(async (id: string) => {
    setTrashError("");
    try {
      await quiltorClient.application.worlds.purge(id);
      const result = await quiltorClient.application.worlds.listTrash();
      setTrash(result.worlds);
    } catch (error) {
      setTrashError(applicationErrorMessage(error));
      throw error;
    }
  }, []);
  const projectImported = useCallback(
    async (imported: WorldInfo) => {
      const generation = ++loadGeneration.current;
      pendingCreatedWorld.current = null;
      setLoadError("");
      const loaded = await loadWorld(
        Promise.resolve({ ok: true, world: imported }),
        generation,
        "import",
        true,
      );
      if (!loaded) return;
      void quiltorClient.application.worlds
        .list()
        .then((listed) => setWorlds(listed.worlds))
        .catch(() => undefined);
    },
    [loadWorld],
  );
  const close = useCallback(() => {
    const leaving = openWorld.current;
    openWorld.current = null;
    setPreviewExpired(false);
    // Left without a change: the preview goes, and leaves nothing in the list (D-127). A
    // world that became real meanwhile stays; the server decides that, not this check.
    if (leaving?.preview) quiltorClient.application.worlds.discardPreview(leaving.id);
    const generation = ++loadGeneration.current;
    pendingCreatedWorld.current = null;
    quiltorClient.application.worlds.select("");
    selection.current = { worldId: "", generation };
    setWorld(null);
    setLoadError("");

    const url = new URL(location.href);
    url.searchParams.delete("world");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    void quiltorClient.application.worlds
      .list()
      .then((result) => {
        if (generation === loadGeneration.current) setWorlds(result.worlds);
      })
      .catch((error) => {
        if (generation === loadGeneration.current) setLoadError(applicationErrorMessage(error));
      });
  }, []);
  // True only while the gateway still points at the selection these documents were loaded for.
  const isSelected = useCallback(
    (binding: WorldBinding) =>
      binding.worldId !== "" &&
      selection.current.worldId === binding.worldId &&
      selection.current.generation === binding.generation,
    [],
  );

  return {
    worlds,
    world,
    needsSignIn,
    authError,
    loadError,
    trash,
    trashError,
    previewExpired,
    open,
    openExample,
    adoptWorld,
    markPreviewExpired,
    create,
    remove,
    loadTrash,
    restore,
    purge,
    projectImported,
    close,
    isSelected,
  };
}
