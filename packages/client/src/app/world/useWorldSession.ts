import { useCallback, useEffect, useState } from "react";
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

  const loadWorld = useCallback(
    async (selected: Promise<{ ok: boolean; world: WorldInfo }>, rejectOnFailure = false) => {
      setLoadError("");
      try {
        const result = await selected;
        quiltorClient.application.worlds.select(result.world.id);
        const [manuscript, figures, storyboards] = await Promise.all([
          quiltorClient.application.manuscript.load(),
          quiltorClient.application.storyWorld.load(),
          quiltorClient.application.storyboards.load(),
        ]);
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
      } catch (error) {
        setLoadError(applicationErrorMessage(error));
        if (rejectOnFailure) throw error;
      }
    },
    [onDocumentsLoaded],
  );

  useEffect(() => {
    quiltorClient.application.worlds
      .list()
      .then((result) => {
        setWorlds(result.worlds);
        const requested = new URLSearchParams(location.search).get("world");
        if (requested) void loadWorld(quiltorClient.application.worlds.open(requested));
      })
      .catch((error) => {
        if (error instanceof ApplicationGatewayError && error.category === "unauthorized") {
          setNeedsSignIn(true);
          return;
        }
        setWorlds([]);
        setLoadError(applicationErrorMessage(error));
      });
  }, [loadWorld]);

  useEffect(() => {
    if (authError) history.replaceState(null, "", location.pathname);
  }, [authError]);

  const open = useCallback(
    (id: string) => loadWorld(quiltorClient.application.worlds.open(id)),
    [loadWorld],
  );
  const create = useCallback(
    (title: string, backupUrl: string) =>
      loadWorld(quiltorClient.application.worlds.create(title, backupUrl)),
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
      await loadWorld(Promise.resolve({ ok: true, world: imported }), true);
      void quiltorClient.application.worlds
        .list()
        .then((listed) => setWorlds(listed.worlds))
        .catch(() => undefined);
    },
    [loadWorld],
  );
  const close = useCallback(() => {
    quiltorClient.application.worlds.select("");
    setWorld(null);
    setLoadError("");

    const url = new URL(location.href);
    url.searchParams.delete("world");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    void quiltorClient.application.worlds
      .list()
      .then((result) => setWorlds(result.worlds))
      .catch((error) => setLoadError(applicationErrorMessage(error)));
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
