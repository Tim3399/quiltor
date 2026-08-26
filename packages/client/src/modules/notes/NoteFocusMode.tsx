import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Dialog, TextArea } from "../../design";
import type { NoteFocusCopy, NoteOwner } from "./model";
import { noteOwnerKey } from "./model";

export function NoteFocusMode({
  owner,
  value,
  onChange,
  copy,
  placeholder,
  returnFocusRef,
  onClose,
}: {
  owner: NoteOwner;
  value: string;
  onChange: (value: string) => void;
  copy: NoteFocusCopy;
  placeholder?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  return createPortal(
    <Dialog
      className="note-focus-mode"
      title={copy.title}
      closeLabel={copy.closeLabel}
      size="focus"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      <div className="note-focus-mode__body" data-note-owner={noteOwnerKey(owner)}>
        <TextArea
          fieldClassName="note-focus-mode__field"
          className="note-focus-mode__control"
          label={copy.editorLabel}
          labelHidden
          value={value}
          placeholder={placeholder}
          data-autofocus
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Dialog>,
    document.body,
  );
}
