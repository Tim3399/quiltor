export type NoteOwner =
  | { kind: "chapter"; id: string }
  | { kind: "entity"; id: string }
  | { kind: "place"; id: string }
  | { kind: "timeline"; id: string }
  | { kind: "storyboard"; id: string };

export function noteOwnerKey(owner: NoteOwner) {
  return `${owner.kind}:${owner.id}`;
}

export interface NoteFocusCopy {
  openLabel: string;
  title: string;
  closeLabel: string;
  editorLabel: string;
}
