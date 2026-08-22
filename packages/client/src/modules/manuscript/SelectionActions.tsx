import { useRef, type MutableRefObject } from "react";
import { useI18n } from "../../i18n";
import { SelectionMenu } from "../../shared/ui/SelectionMenu";
import { useShortcut } from "../../shared/ui/shortcuts";
import type { ManuscriptEditorHandle } from "./ManuscriptEditor";
import type { WorkspaceSelection, WritingTool } from "./workspaceTypes";
import "./SelectionActions.css";

interface SelectionActionsProps {
  editorRef: MutableRefObject<ManuscriptEditorHandle | null>;
  selection: WorkspaceSelection | null;
  liveSelection: WorkspaceSelection | null;
  open: boolean;
  selectionTool: WritingTool;
  onClose: () => void;
  onCopy: (text: string) => Promise<boolean>;
  onOpenWritingTool: (tool: WritingTool) => void;
}

export function SelectionActions({
  editorRef,
  selection,
  liveSelection,
  open,
  selectionTool,
  onClose,
  onCopy,
  onOpenWritingTool,
}: SelectionActionsProps) {
  const { t } = useI18n();
  const keys = useShortcut();
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        className="selection-anchor"
        tabIndex={-1}
        aria-hidden="true"
        style={
          selection
            ? {
                left: selection.rect.left,
                top: selection.rect.top,
                width: selection.rect.width,
                height: selection.rect.height,
              }
            : undefined
        }
        onFocus={() => editorRef.current?.focus()}
      />
      <SelectionMenu
        anchorRef={anchorRef}
        open={open && !!liveSelection}
        label={t("writingSelectionActions")}
        onClose={onClose}
        actions={[
          {
            id: "cut",
            label: t("cut"),
            shortcut: keys("X"),
            run: () => {
              if (liveSelection) {
                const { from, to, text } = liveSelection;
                void onCopy(text).then((ok) => {
                  if (ok) editorRef.current?.cut(from, to);
                });
              }
            },
          },
          {
            id: "copy",
            label: t("copy"),
            shortcut: keys("C"),
            run: () => {
              if (liveSelection) void onCopy(liveSelection.text);
            },
          },
          {
            id: "bold",
            label: t("formatBold"),
            shortcut: keys("B"),
            separatorBefore: true,
            run: () => {
              if (liveSelection) editorRef.current?.toggleMark("bold", liveSelection);
            },
          },
          {
            id: "italic",
            label: t("formatItalic"),
            shortcut: keys("I"),
            run: () => {
              if (liveSelection) editorRef.current?.toggleMark("italic", liveSelection);
            },
          },
          {
            id: "lookup",
            label: t("lookup"),
            separatorBefore: true,
            run: () => onOpenWritingTool("lookup"),
          },
          { id: "synonyms", label: t("synonyms"), run: () => onOpenWritingTool("synonyms") },
          { id: "translate", label: t("translate"), run: () => onOpenWritingTool("translate") },
          { id: "more", label: t("writingMore"), run: () => onOpenWritingTool(selectionTool) },
        ]}
      />
    </>
  );
}
