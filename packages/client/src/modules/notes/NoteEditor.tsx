import { Focus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { IconButton } from "../../design";
import type { NoteReference } from "../../shared";
import type { NoteFocusCopy, NoteOwner } from "./model";
import { noteOwnerKey } from "./model";
import { NoteFocusMode } from "./NoteFocusMode";
import { useNoteReferenceContext } from "./NoteReferenceContext";
import { ReferenceTextEditor } from "./ReferenceTextEditor";
import "./NoteEditor.css";

const noReferences: readonly NoteReference[] = [];

export function NoteEditor({
  owner,
  label,
  value,
  references = noReferences,
  onChange,
  placeholder,
  size = "comfortable",
  rows,
  labelHidden = false,
  fieldClassName = "",
  className = "",
  focus,
  focusButtonClassName = "",
  onFocusRequest,
}: {
  owner: NoteOwner;
  label: ReactNode;
  value: string;
  references?: readonly NoteReference[];
  onChange: (value: string, references: NoteReference[]) => void;
  placeholder?: string;
  size?: "compact" | "comfortable";
  rows?: number;
  labelHidden?: boolean;
  fieldClassName?: string;
  className?: string;
  focus?: NoteFocusCopy;
  focusButtonClassName?: string;
  onFocusRequest?: (owner: NoteOwner) => void;
}) {
  const ownerKey = noteOwnerKey(owner);
  const referenceContext = useNoteReferenceContext();
  const [focusOpen, setFocusOpen] = useState(false);
  const focusTrigger = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the stable owner must close an overlay that still belongs to the previous owner.
  useEffect(() => setFocusOpen(false), [ownerKey]);

  const openFocus = () => {
    onFocusRequest?.(owner);
    setFocusOpen(true);
  };

  const ariaLabel = typeof label === "string" ? label : focus?.editorLabel || ownerKey;

  return (
    <section className={`note-editor note-editor--${size}`} data-note-owner={ownerKey}>
      <ReferenceTextEditor
        fieldClassName={fieldClassName}
        className={className}
        label={label}
        ariaLabel={ariaLabel}
        labelHidden={labelHidden}
        actions={
          focus ? (
            <IconButton
              ref={focusTrigger}
              className={`note-editor__focus ${focusButtonClassName}`.trim()}
              label={focus.openLabel}
              icon={<Focus />}
              onClick={openFocus}
            />
          ) : undefined
        }
        value={value}
        references={references}
        candidates={referenceContext.candidates}
        onOpenReference={referenceContext.onOpenReference}
        rows={rows}
        placeholder={placeholder}
        onChange={onChange}
      />
      {focusOpen && focus && (
        <NoteFocusMode
          owner={owner}
          value={value}
          references={references}
          onChange={onChange}
          candidates={referenceContext.candidates}
          onOpenReference={referenceContext.onOpenReference}
          copy={focus}
          placeholder={placeholder}
          returnFocusRef={focusTrigger}
          onClose={() => setFocusOpen(false)}
        />
      )}
    </section>
  );
}
