import { createContext, type ReactNode, useContext } from "react";
import type {
  WorldReferenceBacklink,
  WorldReferenceBacklinkIndex,
  WorldReferenceCandidate,
  WorldReferenceTarget,
} from "../world-references";

const emptyWorldReferenceBacklinks: WorldReferenceBacklinkIndex = new Map();

type NoteReferenceContextValue = {
  candidates: readonly WorldReferenceCandidate[];
  backlinks: WorldReferenceBacklinkIndex;
  onOpenReference: (target: WorldReferenceTarget) => void;
  onOpenBacklink: (backlink: WorldReferenceBacklink) => void;
};

const NoteReferenceContext = createContext<NoteReferenceContextValue>({
  candidates: [],
  backlinks: emptyWorldReferenceBacklinks,
  onOpenReference: () => undefined,
  onOpenBacklink: () => undefined,
});

export function NoteReferenceProvider({
  candidates,
  backlinks = emptyWorldReferenceBacklinks,
  onOpenReference,
  onOpenBacklink,
  children,
}: Omit<NoteReferenceContextValue, "backlinks" | "onOpenBacklink"> & {
  backlinks?: WorldReferenceBacklinkIndex;
  onOpenBacklink?: (backlink: WorldReferenceBacklink) => void;
  children: ReactNode;
}) {
  const openBacklink =
    onOpenBacklink ??
    ((backlink: WorldReferenceBacklink) => onOpenReference(backlink.source.target));
  return (
    <NoteReferenceContext.Provider
      value={{ candidates, backlinks, onOpenReference, onOpenBacklink: openBacklink }}
    >
      {children}
    </NoteReferenceContext.Provider>
  );
}

export function useNoteReferenceContext() {
  return useContext(NoteReferenceContext);
}
