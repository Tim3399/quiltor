import { Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { IconButton, TextArea } from "../../design";
import type { NoteFocusCopy, NoteOwner } from "./model";
import { noteOwnerKey } from "./model";
import { NoteFocusMode } from "./NoteFocusMode";
import "./NoteEditor.css";

export function NoteEditor({
  owner,
  label,
  value,
  onChange,
  placeholder,
  size = "comfortable",
  rows,
  fieldClassName = "",
  className = "",
  focus,
  onFocusRequest,
}: {
  owner: NoteOwner;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: "compact" | "comfortable";
  rows?: number;
  fieldClassName?: string;
  className?: string;
  focus?: NoteFocusCopy;
  onFocusRequest?: (owner: NoteOwner) => void;
}) {
  const ownerKey = noteOwnerKey(owner);
  const [focusOpen, setFocusOpen] = useState(false);
  const focusTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => setFocusOpen(false), [ownerKey]);

  const openFocus = () => {
    onFocusRequest?.(owner);
    setFocusOpen(true);
  };

  return (
    <section className={`note-editor note-editor--${size}`} data-note-owner={ownerKey}>
      <TextArea
        fieldClassName={`note-editor__field ${fieldClassName}`.trim()}
        className={`note-editor__control ${className}`.trim()}
        label={label}
        actions={
          focus ? (
            <IconButton
              ref={focusTrigger}
              className="note-editor__focus"
              label={focus.openLabel}
              icon={<Maximize2 />}
              onClick={openFocus}
            />
          ) : undefined
        }
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {focusOpen && focus && (
        <NoteFocusMode
          owner={owner}
          value={value}
          onChange={onChange}
          copy={focus}
          placeholder={placeholder}
          returnFocusRef={focusTrigger}
          onClose={() => setFocusOpen(false)}
        />
      )}
    </section>
  );
}
