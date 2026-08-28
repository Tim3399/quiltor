import { createContext, type ReactNode, useContext } from "react";
import type { WorldReferenceCandidate, WorldReferenceTarget } from "../world-references";

type NoteReferenceContextValue = {
  candidates: readonly WorldReferenceCandidate[];
  onOpenReference: (target: WorldReferenceTarget) => void;
};

const NoteReferenceContext = createContext<NoteReferenceContextValue>({
  candidates: [],
  onOpenReference: () => undefined,
});

export function NoteReferenceProvider({
  candidates,
  onOpenReference,
  children,
}: NoteReferenceContextValue & { children: ReactNode }) {
  return (
    <NoteReferenceContext.Provider value={{ candidates, onOpenReference }}>
      {children}
    </NoteReferenceContext.Provider>
  );
}

export function useNoteReferenceContext() {
  return useContext(NoteReferenceContext);
}
