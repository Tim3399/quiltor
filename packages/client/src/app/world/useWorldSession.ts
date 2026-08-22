import { useCallback, useEffect, useState } from "react";
import { ApplicationGatewayError, applicationErrorMessage, quiltorClient } from "../../platform";
import {
  addDeterministicMentions,
  normalizeMarks,
  reconcileMentions,
  type Manuscript,
} from "../../modules/manuscript";
import type { FigureState, WorldInfo } from "../../modules/story-world";

export type LoadedWorldDocuments = {
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions: number;
};

export function useWorldSession(onDocumentsLoaded: (documents: LoadedWorldDocuments) => void) {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null);
  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [authError] = useState(() => new URLSearchParams(location.search).get("authError"));
  const [loadError, setLoadError] = useState("");

  const loadWorld = useCallback(
    async (selected: Promise<{ ok: boolean; world: WorldInfo }>) => {
      setLoadError("");
      try {
        const result = await selected;
        quiltorClient.application.worlds.select(result.world.id);
        const [manuscript, figures] = await Promise.all([
          quiltorClient.application.manuscript.load(),
          quiltorClient.application.storyWorld.load(),
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
          orphanedMentions: reconciled.orphanedCount,
        });
        setWorld(result.world);
      } catch (error) {
        setLoadError(applicationErrorMessage(error));
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
    await quiltorClient.application.worlds.delete(id);
    const result = await quiltorClient.application.worlds.list();
    setWorlds(result.worlds);
  }, []);

  return {
    worlds,
    world,
    needsSignIn,
    authError,
    loadError,
    open,
    create,
    remove,
  };
}
