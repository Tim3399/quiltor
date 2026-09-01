import { type RefObject, useRef } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../../design";
import type { NoteMark, NoteReference } from "../../shared";
import type { WorldReferenceCandidate, WorldReferenceTarget } from "../world-references";
import type { NoteFocusCopy, NoteOwner } from "./model";
import { noteOwnerKey } from "./model";
import { ReferenceTextEditor } from "./ReferenceTextEditor";

export function NoteFocusMode({
  owner,
  value,
  references,
  marks,
  onChange,
  candidates,
  onOpenReference,
  copy,
  placeholder,
  returnFocusRef,
  onClose,
}: {
  owner: NoteOwner;
  value: string;
  references: readonly NoteReference[];
  marks: readonly NoteMark[];
  onChange: (value: string, references: NoteReference[], marks: NoteMark[]) => void;
  candidates: readonly WorldReferenceCandidate[];
  onOpenReference: (target: WorldReferenceTarget) => void;
  copy: NoteFocusCopy;
  placeholder?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const modalContent = useRef<HTMLDivElement>(null);
  return createPortal(
    <Dialog
      className="note-focus-mode"
      title={copy.title}
      closeLabel={copy.closeLabel}
      size="focus"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      <div
        ref={modalContent}
        className="note-focus-mode__body"
        data-note-owner={noteOwnerKey(owner)}
      >
        <ReferenceTextEditor
          fieldClassName="note-focus-mode__field"
          className="note-focus-mode__control"
          label={copy.editorLabel}
          ariaLabel={copy.editorLabel}
          labelHidden
          value={value}
          references={references}
          marks={marks}
          candidates={candidates}
          onOpenReference={onOpenReference}
          placeholder={placeholder}
          autoFocus
          popoverPortalRef={modalContent}
          onChange={onChange}
        />
      </div>
    </Dialog>,
    document.body,
  );
}
