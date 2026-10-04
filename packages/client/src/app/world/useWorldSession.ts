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

export function useWorldSession(onDocumentsLoaded: (documents: LoadedWorldDocuments) => void) {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null);
  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [trash, setTrash] = useState<(WorldInfo & { deletedAt: string })[] | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [authError] = useState(() => new URLSearchParams(location.search).get("authError"));
  const [loadError, setLoadError] = useState("");
  const [trashError, setTrashError] = useState("");
  const loadGeneration = useRef(0);
  const pendingCreatedWorld = useRef<{
    world: WorldInfo;
    title: string;
    backupUrl: string;
  } | null>(null);

  const loadWorld = useCallback(
    async (
      selected: Promise<{ ok: boolean; world: WorldInfo }>,
      generation: number,
      rejectOnFailure = false,
      onSelected?: (world: WorldInfo) => void,
    ): Promise<boolean> => {
      try {
        const result = await selected;
        if (generation !== loadGeneration.current) return false;
        onSelected?.(result.world);
        quiltorClient.application.worlds.select(result.world.id);
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
        onDocumentsLoaded({
          manuscript: linked,
          figures,
          storyboards,
          orphanedMentions: reconciled.orphanedCount,
        });
        setWorld(result.world);
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
          void loadWorld(quiltorClient.application.worlds.open(requested), generation);
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

  const open = useCallback(
    (id: string) => {
      const generation = ++loadGeneration.current;
      pendingCreatedWorld.current = null;
      setLoadError("");
      return loadWorld(quiltorClient.application.worlds.open(id), generation).then(() => undefined);
    },
    [loadWorld],
  );
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
    const generation = ++loadGeneration.current;
    pendingCreatedWorld.current = null;
    quiltorClient.application.worlds.select("");
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

  return {
    worlds,
    world,
    needsSignIn,
    authError,
    loadError,
    trash,
    trashError,
    open,
    create,
    remove,
    loadTrash,
    restore,
    purge,
    projectImported,
    close,
  };
}
