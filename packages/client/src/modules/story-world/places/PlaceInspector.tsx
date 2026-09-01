import { MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  IconButton,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  TextArea,
  TextField,
} from "../../../design";
import { useI18n } from "../../../i18n";
import type { Workspace } from "../../../shared";
import { NoteEditor, noteFocusCopy } from "../../notes";
import type { FigureNode, FigureState } from "../model";
import { NodePriorityActions } from "../NodePriorityActions";
import { PlaceHistory } from "./PlaceHistory";
import "./PlaceInspector.css";

export function PlaceInspector({
  selected,
  state,
  onPatch,
  onClose,
  onOpen,
}: {
  selected: FigureNode | null;
  state: FigureState;
  onPatch: (patch: Partial<FigureNode>) => void;
  onClose: () => void;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useI18n();
  const [nameDraft, setNameDraft] = useState(selected?.name ?? "");
  const nameDraftOwnerId = useRef(selected?.id ?? null);
  const skipNameCommit = useRef(false);

  useEffect(() => {
    const ownerChanged = nameDraftOwnerId.current !== (selected?.id ?? null);
    nameDraftOwnerId.current = selected?.id ?? null;
    skipNameCommit.current = false;
    const nextName = selected?.name ?? "";
    setNameDraft((current) => (ownerChanged || current !== nextName ? nextName : current));
  }, [selected?.id, selected?.name]);

  const commitName = () => {
    if (skipNameCommit.current) {
      skipNameCommit.current = false;
      return;
    }
    if (!selected || nameDraft === selected.name) return;
    onPatch({ name: nameDraft });
  };

  return (
    <>
      <SidePanelHeader
        className="places-inspector-header"
        title={selected ? selected.name : t("inspector")}
        actions={
          selected ? (
            <IconButton label={t("closeSelection")} icon={<X />} onClick={onClose} />
          ) : undefined
        }
      />
      {!selected ? (
        <SidePanelEmpty
          className="places-inspector-empty"
          icon={<MapPin />}
          title={t("selectPlace")}
        >
          <p>{t("selectPlaceBody")}</p>
        </SidePanelEmpty>
      ) : (
        <>
          <SidePanelBody className="places-place-fields">
            <TextField
              id="place-name"
              label={t("name")}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  skipNameCommit.current = true;
                  setNameDraft(selected.name);
                  event.currentTarget.blur();
                }
              }}
            />
            <TextArea
              id="place-short-description"
              label={t("shortDescription")}
              value={selected.sub || ""}
              onChange={(event) => onPatch({ sub: event.target.value })}
            />
            <NoteEditor
              owner={{ kind: "place", id: selected.id }}
              label={t("profileNotes")}
              value={selected.profile?.notizen || ""}
              references={selected.profile?.noteReferences}
              marks={selected.profile?.noteMarks}
              onChange={(notizen, noteReferences, noteMarks) =>
                onPatch({ profile: { ...selected.profile, notizen, noteReferences, noteMarks } })
              }
              focus={noteFocusCopy(t, selected.name)}
            />
            <NodePriorityActions
              className="places-priority-actions"
              actionClassName="places-priority-action"
              important={!!selected.important}
              pinned={!!selected.pinned}
              importantLabel={selected.important ? t("unfavoritePlace") : t("favoritePlace")}
              pinnedLabel={selected.pinned ? t("unlockPlacePosition") : t("lockPlacePosition")}
              onImportantChange={(important) => onPatch({ important })}
              onPinnedChange={(pinned) => onPatch({ pinned })}
            />
          </SidePanelBody>
          <PlaceHistory place={selected} state={state} onOpen={onOpen} />
        </>
      )}
    </>
  );
}
