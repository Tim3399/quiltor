import { MapPin, X } from "lucide-react";
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
              value={selected.name}
              onChange={(event) => onPatch({ name: event.target.value })}
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
              onChange={(notizen, noteReferences) =>
                onPatch({ profile: { ...selected.profile, notizen, noteReferences } })
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
