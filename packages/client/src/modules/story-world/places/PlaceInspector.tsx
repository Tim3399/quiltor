import {
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  MapPin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hasMapSize } from "./placeLevels";
import {
  Button,
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
import { PlaceMapSection } from "./PlaceMapSection";
import "./PlaceInspector.css";

export function PlaceInspector({
  selected,
  state,
  onPatch,
  onClose,
  onOpen,
  mapImageUrl,
  onChooseMapImage,
  onRemoveMapImage,
  onPlaceDisplayChange,
  onDelete,
  onOpenLevel,
  levelFilled = false,
  onExpandMap,
}: {
  selected: FigureNode | null;
  state: FigureState;
  onPatch: (patch: Partial<FigureNode>) => void;
  onClose: () => void;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
  /** Where a stored picture can be read from. */
  mapImageUrl: (imageId: string) => string;
  onChooseMapImage: (place: FigureNode) => void;
  onRemoveMapImage: (place: FigureNode) => void;
  onPlaceDisplayChange?: (place: FigureNode, display: "card" | "pin") => void;
  onDelete?: (place: FigureNode) => void;
  /**
   * The card's own commands, offered here where the card cannot show them: on a phone the
   * inspector is a sheet over the whole canvas, so the commands on the card lie under it
   * (D-T-219-F2). Given only there, like onDelete.
   */
  onOpenLevel?: (place: FigureNode) => void;
  /** Whether the place already holds a level, which turns "start" into "open". */
  levelFilled?: boolean;
  onExpandMap?: (place: FigureNode) => void;
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

  /**
   * Whether this element is a map rather than a place.
   *
   * A map is a picture to lay places onto, not somewhere anybody stood -- and
   * that is true of it whether it is opened out as ground or sitting collapsed
   * as a card waiting to be. So what a place records, a map is not asked: no
   * short description, no presence, no chronicle. Nothing is deleted by it;
   * take the picture away and the element is a place again, with whatever it
   * had still on it.
   */
  const isMap = Boolean(selected?.mapImageId);

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
            {isMap ? null : (
              <TextArea
                id="place-short-description"
                label={t("shortDescription")}
                value={selected.sub || ""}
                onChange={(event) => onPatch({ sub: event.target.value })}
              />
            )}
            <PlaceMapSection
              place={selected}
              source={selected.mapImageId ? mapImageUrl(selected.mapImageId) : null}
              onChoose={() => onChooseMapImage(selected)}
              onRemove={() => onRemoveMapImage(selected)}
            />
            {isMap ? null : (
              <Button
                className="places-display-action"
                appearance="secondary"
                // The label carries the place's name, so it wraps instead of being cut (T-124).
                labelOverflow="wrap"
                icon={selected.placeDisplay === "pin" ? <ChevronsUpDown /> : <ChevronsDownUp />}
                onClick={() =>
                  (onPlaceDisplayChange ?? ((_, display) => onPatch({ placeDisplay: display })))(
                    selected,
                    selected.placeDisplay === "pin" ? "card" : "pin",
                  )
                }
              >
                {selected.placeDisplay === "pin"
                  ? t("placeShowAsCard", { name: selected.name })
                  : t("placeShowAsPin", { name: selected.name })}
              </Button>
            )}
            {/* In the card's order: the display toggle above, then open out, then the level. */}
            {/* Only a map with a size opens out, the same rule as on the card (T-79). */}
            {isMap && selected && hasMapSize(selected) && onExpandMap ? (
              <Button
                className="places-display-action"
                appearance="secondary"
                labelOverflow="wrap"
                icon={<ChevronsUpDown />}
                onClick={() => onExpandMap(selected)}
              >
                {t("placeExpandMap", { name: selected.name })}
              </Button>
            ) : null}
            {onOpenLevel ? (
              <Button
                className="places-display-action"
                appearance="secondary"
                labelOverflow="wrap"
                icon={levelFilled ? <CornerDownRight /> : <Plus />}
                onClick={() => onOpenLevel(selected)}
              >
                {levelFilled
                  ? t("placeOpenLevel", { name: selected.name })
                  : t("placeStartLevel", { name: selected.name })}
              </Button>
            ) : null}
            <NoteEditor
              owner={{ kind: "place", id: selected.id }}
              label={t("profileNotes")}
              value={selected.profile?.notes || ""}
              references={selected.profile?.noteReferences}
              marks={selected.profile?.noteMarks}
              onChange={(notes, noteReferences, noteMarks) =>
                onPatch({ profile: { ...selected.profile, notes, noteReferences, noteMarks } })
              }
              focus={noteFocusCopy(t, selected.name)}
            />
            <NodePriorityActions
              className="places-priority-actions"
              important={!!selected.important}
              pinned={!!selected.pinned}
              importantLabel={selected.important ? t("unfavoritePlace") : t("favoritePlace")}
              pinnedLabel={selected.pinned ? t("unlockPlacePosition") : t("lockPlacePosition")}
              onImportantChange={(important) => onPatch({ important })}
              onPinnedChange={(pinned) => onPatch({ pinned })}
            />
            {onDelete ? (
              <Button
                className="places-inspector-delete"
                tone="danger"
                icon={<Trash2 />}
                onClick={() => onDelete(selected)}
              >
                {t("deletePlace")}
              </Button>
            ) : null}
          </SidePanelBody>
          {isMap ? null : <PlaceHistory place={selected} state={state} onOpen={onOpen} />}
        </>
      )}
    </>
  );
}
