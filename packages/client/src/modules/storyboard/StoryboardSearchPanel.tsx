import {
  ExternalLink,
  GripVertical,
  LayoutDashboard,
  Library,
  Search,
  StickyNote,
} from "lucide-react";
import type { DragEvent } from "react";
import { Button, ScrollArea, SelectionCard, TextField } from "../../design";
import { useI18n } from "../../i18n";
import { searchWorldReferences, type WorldReferenceCandidate } from "../world-references";
import {
  referenceDragValue,
  STORYBOARD_NODE_DRAG_MIME,
  STORYBOARD_REFERENCE_DRAG_MIME,
  storyboardNodeDragValue,
} from "./storyboardCanvasModel";

export function StoryboardSearchPanel({
  candidates,
  query,
  onQueryChange,
  onAddNote,
  onPlace,
}: {
  candidates: readonly WorldReferenceCandidate[];
  query: string;
  onQueryChange: (query: string) => void;
  onAddNote: () => void;
  onPlace: (candidate: WorldReferenceCandidate) => void;
}) {
  const { t } = useI18n();
  const results = searchWorldReferences(candidates, query, 80);
  const startNoteDrag = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(STORYBOARD_NODE_DRAG_MIME, storyboardNodeDragValue("note"));
  };
  const startDrag = (event: DragEvent<HTMLButtonElement>, candidate: WorldReferenceCandidate) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(STORYBOARD_REFERENCE_DRAG_MIME, referenceDragValue(candidate));
  };

  return (
    <aside className="storyboard-library" aria-label={t("storyboardLibraryTitle")}>
      <div className="storyboard-library__heading">
        <Library aria-hidden="true" />
        <div>
          <strong>{t("storyboardLibraryTitle")}</strong>
          <small>{t("storyboardLibraryHint")}</small>
        </div>
      </div>
      <SelectionCard
        className="storyboard-library__note"
        label={t("storyboardPlaceBlankNote")}
        title={t("storyboardBlankNote")}
        description={t("storyboardBlankNoteHint")}
        leading={<StickyNote />}
        indicator={<GripVertical />}
        draggable
        onDragStart={startNoteDrag}
        onSelect={() => onAddNote()}
      />
      <section
        className="storyboard-library__world"
        aria-labelledby="storyboard-world-search-title"
      >
        <div className="storyboard-library__heading storyboard-library__heading--section">
          <Search aria-hidden="true" />
          <div>
            <strong id="storyboard-world-search-title">{t("storyboardSearchLabel")}</strong>
            <small>{t("storyboardSearchHint")}</small>
          </div>
        </div>
        <TextField
          fieldClassName="storyboard-search-field"
          label={t("storyboardSearchLabel")}
          labelHidden
          type="search"
          value={query}
          placeholder={t("storyboardSearchPlaceholder")}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <ScrollArea
          as="ul"
          className="storyboard-search-results"
          axis="y"
          surface="panel"
          aria-live="polite"
        >
          {results.map((candidate) => (
            <li key={candidate.id}>
              <Button
                className="storyboard-search-result"
                appearance="ghost"
                size="touch"
                icon={
                  candidate.target.kind === "storyboard" ? <LayoutDashboard /> : <ExternalLink />
                }
                draggable
                aria-label={t("storyboardPlaceReference", { name: candidate.label })}
                title={t("storyboardPlaceReference", { name: candidate.label })}
                onDragStart={(event) => startDrag(event, candidate)}
                onClick={() => onPlace(candidate)}
              >
                <span className="storyboard-search-result__copy">
                  <strong>{candidate.label}</strong>
                  <small>{candidate.detail || t("storyboardResultDetailFallback")}</small>
                </span>
                <GripVertical className="storyboard-search-result__grip" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {!results.length && (
            <li className="storyboard-search-empty">{t("storyboardSearchEmpty")}</li>
          )}
        </ScrollArea>
      </section>
    </aside>
  );
}
