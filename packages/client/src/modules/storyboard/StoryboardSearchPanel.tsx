import {
  BookOpen,
  Boxes,
  Building2,
  Clock,
  ExternalLink,
  GripVertical,
  LayoutDashboard,
  Library,
  Lightbulb,
  MapPin,
  PawPrint,
  Search,
  StickyNote,
  Users,
} from "lucide-react";
import type { DragEvent } from "react";
import { Button, CollapsibleGroup, ScrollArea, SelectionCard, TextField } from "../../design";
import { useI18n } from "../../i18n";
import { useCollapsedGroups } from "../../shared/hooks/useCollapsedGroups";
import type { CardKind } from "../graph";
import { kindLabel } from "../story-world";
import { searchWorldReferences, type WorldReferenceCandidate } from "../world-references";
import { groupLibraryCandidates } from "./storyboardLibraryModel";
import {
  referenceDragValue,
  STORYBOARD_NODE_DRAG_MIME,
  STORYBOARD_REFERENCE_DRAG_MIME,
  storyboardNodeDragValue,
} from "./storyboardCanvasModel";

const KIND_ICON: Partial<Record<CardKind, typeof Users>> = {
  chapter: BookOpen,
  person: Users,
  tier: PawPrint,
  ort: MapPin,
  organisation: Building2,
  objekt: Boxes,
  konzept: Lightbulb,
  timeline: Clock,
  storyboard: LayoutDashboard,
};

export function StoryboardSearchPanel({
  worldId,
  candidates,
  query,
  onQueryChange,
  onAddNote,
  onPlace,
}: {
  /** The open world: the folded groups are remembered per world. */
  worldId?: string;
  candidates: readonly WorldReferenceCandidate[];
  query: string;
  onQueryChange: (query: string) => void;
  onAddNote: () => void;
  onPlace: (candidate: WorldReferenceCandidate) => void;
}) {
  const { t } = useI18n();
  const results = searchWorldReferences(candidates, query, 80);
  const groups = groupLibraryCandidates(results);
  const { isCollapsed, setCollapsed } = useCollapsedGroups("storyboard-library", worldId);
  // A search that hides its own hits behind a folded group would look like no result at all.
  const searching = query.trim() !== "";
  const groupTitle = (kind: CardKind) => {
    if (kind === "chapter") return t("chapter");
    if (kind === "timeline") return t("moment");
    if (kind === "storyboard") return t("storyboard");
    return kindLabel(
      kind === "reference" || kind === "note" || kind === "group" ? undefined : kind,
      t,
    );
  };
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
        descriptionLayout="wrap"
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
          {groups.map((group) => {
            const Icon = KIND_ICON[group.kind] ?? ExternalLink;
            return (
              <li key={group.kind}>
                <CollapsibleGroup
                  id={`storyboard-library-${group.kind}`}
                  className="storyboard-library__group"
                  icon={<Icon />}
                  title={groupTitle(group.kind)}
                  count={group.candidates.length}
                  open={searching || !isCollapsed(group.kind)}
                  onOpenChange={(open) => {
                    if (!searching) setCollapsed(group.kind, !open);
                  }}
                >
                  <ul className="storyboard-library__entries">
                    {group.candidates.map((candidate) => (
                      <li key={candidate.id}>
                        <Button
                          className="storyboard-search-result"
                          appearance="ghost"
                          size="compact"
                          icon={<GripVertical />}
                          iconPosition="end"
                          draggable
                          aria-label={t("storyboardPlaceReference", { name: candidate.label })}
                          title={t("storyboardPlaceReference", { name: candidate.label })}
                          onDragStart={(event) => startDrag(event, candidate)}
                          onClick={() => onPlace(candidate)}
                        >
                          {candidate.label}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </CollapsibleGroup>
              </li>
            );
          })}
          {!groups.length && (
            <li className="storyboard-search-empty">{t("storyboardSearchEmpty")}</li>
          )}
        </ScrollArea>
      </section>
    </aside>
  );
}
