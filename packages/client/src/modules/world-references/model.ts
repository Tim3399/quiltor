import type { Workspace, WorldReferenceTarget } from "../../shared";
import type { CardKind } from "../graph";

export type { NoteReference, WorldReferenceTarget } from "../../shared";
export { worldReferenceKey } from "../../shared";

export interface WorldReferenceCandidate {
  id: string;
  target: WorldReferenceTarget;
  label: string;
  detail: string;
  keywords: string[];
  workspace: Workspace;
  /** Live semantic kind used by every visual card/minimap projection. */
  cardKind: CardKind;
}

export type WorldReferenceBacklinkSourceKind =
  | "chapter-note"
  | "chapter-mention"
  | "entity-note"
  | "place-note"
  | "timeline-note"
  | "storyboard-note"
  | "storyboard-reference";

interface WorldReferenceBacklinkSourceBase {
  target: WorldReferenceTarget;
  workspace: WorldReferenceCandidate["workspace"];
  label: string;
  detail: string;
}

type DocumentBacklinkSourceKind = Exclude<
  WorldReferenceBacklinkSourceKind,
  "storyboard-note" | "storyboard-reference"
>;

export type WorldReferenceBacklinkSource =
  | (WorldReferenceBacklinkSourceBase & {
      kind: DocumentBacklinkSourceKind;
      boardId?: never;
      nodeId?: never;
    })
  | (WorldReferenceBacklinkSourceBase & {
      kind: "storyboard-note" | "storyboard-reference";
      boardId: string;
      nodeId: string;
    });

interface WorldReferenceBacklinkBase {
  id: string;
  target: WorldReferenceTarget;
  source: WorldReferenceBacklinkSource;
}

/** A reverse link backed by an exact author-owned text range. */
export interface WorldReferenceTextBacklink extends WorldReferenceBacklinkBase {
  origin: "text";
  surface: string;
  from: number;
  to: number;
}

/** A reverse link represented by a direct Storyboard reference card, without a fake text span. */
export interface WorldReferenceCardBacklink extends WorldReferenceBacklinkBase {
  origin: "card";
  surface?: never;
  from?: never;
  to?: never;
}

export type WorldReferenceBacklink = WorldReferenceTextBacklink | WorldReferenceCardBacklink;

export type WorldReferenceBacklinkIndex = ReadonlyMap<string, readonly WorldReferenceBacklink[]>;

export interface StoryboardReferenceSource {
  id: string;
  title: string;
  detail?: string;
  keywords?: string[];
}
