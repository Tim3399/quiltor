import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import type { StoryboardState } from "../storyboard";
import type { VersionedDocument } from "../../platform";

export interface RecoveryDocuments {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards: StoryboardState;
}

export interface PersistedRecoveryDocuments {
  manuscript: VersionedDocument<Manuscript>;
  figures: VersionedDocument<FigureState>;
  storyboards: VersionedDocument<StoryboardState>;
}

export function manuscriptText(manuscript: Manuscript): string {
  return manuscript.chapters
    .map((chapter) => [chapter.title, chapter.body].filter(Boolean).join("\n\n"))
    .filter(Boolean)
    .join("\n\n\n");
}

export function recoveryJson(documents: RecoveryDocuments): string {
  return `${JSON.stringify(
    {
      format: "quiltor-recovery",
      version: 1,
      ...documents,
    },
    null,
    2,
  )}\n`;
}

export function conflictRecoveryJson(
  local: RecoveryDocuments,
  persisted: PersistedRecoveryDocuments,
): string {
  return `${JSON.stringify(
    {
      format: "quiltor-conflict-recovery",
      version: 1,
      local,
      persisted: {
        manuscript: persisted.manuscript.document,
        figures: persisted.figures.document,
        storyboards: persisted.storyboards.document,
      },
      persistedRevisions: {
        manuscript: persisted.manuscript.revision,
        figures: persisted.figures.revision,
        storyboards: persisted.storyboards.revision,
      },
    },
    null,
    2,
  )}\n`;
}
