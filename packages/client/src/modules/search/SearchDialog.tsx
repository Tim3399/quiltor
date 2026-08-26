import { Clock3, Command, FileText, MapPin, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { CommandPalette, type CommandPaletteItem } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace, WorkspaceTarget } from "../../shared";
import { type Manuscript, textSearchRanges } from "../manuscript";
import type { FigureState } from "../story-world";
import { kindLabel } from "../story-world";
import {
  buildWorldReferenceCandidates,
  searchWorldReferences,
  type WorldReferenceTarget,
  workspaceTargetForReference,
} from "../world-references";

export function SearchDialog({
  manuscript,
  figures,
  onClose,
  onWorkspace,
  onSelect,
  onCommand,
}: {
  manuscript: Manuscript;
  figures: FigureState;
  onClose: () => void;
  onWorkspace: (value: Workspace) => void;
  onSelect: (target: WorkspaceTarget) => void;
  onCommand: (command: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const items = useMemo<CommandPaletteItem[]>(() => {
    const commands: CommandPaletteItem[] = [
      ["text", t("switchToManuscript")],
      ["figures", t("switchToFigures")],
      ["timeline", t("switchToTimeline")],
      ["places", t("switchToPlaces")],
      ["focus", t("toggleFocus")],
      ["history", t("openHistory")],
      ["snapshot", t("openBackupDialog")],
      ["backups", t("openBackups")],
    ].map(([id, label]) => ({
      id: `command-${id}`,
      label,
      detail: t("command"),
      icon: <Command />,
      onSelect: () => onCommand(id),
    }));
    const needle = query.trim();
    const chaptersById = new Map(manuscript.chapters.map((chapter) => [chapter.id, chapter]));
    const candidates = buildWorldReferenceCandidates({
      manuscript,
      figures,
      labels: {
        untitled: t("untitled"),
        moment: t("moment"),
        figureKind: (kind) => kindLabel(kind, t),
      },
    });
    const references: CommandPaletteItem[] = searchWorldReferences(candidates, needle, 100).map(
      (candidate) => {
        const chapter =
          candidate.target.kind === "chapter" ? chaptersById.get(candidate.target.id) : undefined;
        const matches = chapter && needle ? textSearchRanges(chapter.body, needle) : [];
        const first = matches[0];
        const matchDetail = first
          ? `${t("searchMatchCount", { count: matches.length })} · ${matchPreview(
              chapter?.body ?? "",
              first.from,
              first.to,
            )}`
          : "";
        return {
          id: candidate.id,
          label: candidate.label,
          detail: [candidate.detail, matchDetail].filter(Boolean).join(" · "),
          keywords: candidate.keywords,
          icon: referenceIcon(candidate.target),
          requiresQuery: true,
          onSelect: () => {
            const target = workspaceTargetForReference(candidate.target);
            if (!target || candidate.workspace === "storyboard") return;
            onWorkspace(candidate.workspace);
            onSelect({
              ...target,
              ...(first ? { textSearch: { query: needle, from: first.from, to: first.to } } : {}),
            });
          },
        };
      },
    );
    return [...commands, ...references];
  }, [manuscript, figures.nodes, figures.timeline, onCommand, onWorkspace, onSelect, query, t]);
  return (
    <CommandPalette
      open
      label={t("searchCommands")}
      closeLabel={t("closeDialog")}
      inputLabel={t("searchTerm")}
      placeholder={t("searchPlaceholder")}
      emptyLabel={t("noSearchResults")}
      items={items}
      onClose={onClose}
      onQueryChange={setQuery}
    />
  );
}

function referenceIcon(target: WorldReferenceTarget) {
  switch (target.kind) {
    case "chapter":
      return <FileText />;
    case "place":
      return <MapPin />;
    case "timeline":
      return <Clock3 />;
    case "entity":
      return <UserRound />;
    case "storyboard":
      return <FileText />;
  }
}

function matchPreview(value: string, from: number, to: number) {
  const start = Math.max(0, from - 42),
    end = Math.min(value.length, to + 74);
  return `${start ? "…" : ""}${value.slice(start, end).replace(/\s+/g, " ").trim()}${
    end < value.length ? "…" : ""
  }`;
}
