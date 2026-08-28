import type { WorldReferenceTarget } from "../../shared";

export type { NoteReference, WorldReferenceTarget } from "../../shared";
export { worldReferenceKey } from "../../shared";

export interface WorldReferenceCandidate {
  id: string;
  target: WorldReferenceTarget;
  label: string;
  detail: string;
  keywords: string[];
  workspace: "text" | "figures" | "timeline" | "places" | "storyboard";
}

export type WorldReferenceBacklinkSourceKind =
  | "chapter-note"
  | "chapter-mention"
  | "entity-note"
  | "place-note"
  | "timeline-note";

export interface WorldReferenceBacklinkSource {
  target: WorldReferenceTarget;
  workspace: WorldReferenceCandidate["workspace"];
  label: string;
  detail: string;
  kind: WorldReferenceBacklinkSourceKind;
}

/** A deterministic reverse link from an author-owned text surface to a stable world target. */
export interface WorldReferenceBacklink {
  id: string;
  target: WorldReferenceTarget;
  source: WorldReferenceBacklinkSource;
  surface: string;
  from: number;
  to: number;
}

export type WorldReferenceBacklinkIndex = ReadonlyMap<string, readonly WorldReferenceBacklink[]>;

export interface StoryboardReferenceSource {
  id: string;
  title: string;
  detail?: string;
  keywords?: string[];
}
