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

export interface StoryboardReferenceSource {
  id: string;
  title: string;
  detail?: string;
  keywords?: string[];
}
