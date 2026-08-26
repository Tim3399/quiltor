export type WorldReferenceTarget =
  | { kind: "entity"; id: string }
  | { kind: "place"; id: string }
  | { kind: "timeline"; id: string }
  | { kind: "chapter"; id: string }
  | { kind: "storyboard"; id: string };

export interface NoteReference {
  id: string;
  target: WorldReferenceTarget;
  from: number;
  to: number;
  surface: string;
}

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

export function worldReferenceKey(target: WorldReferenceTarget) {
  return `${target.kind}:${target.id}`;
}
