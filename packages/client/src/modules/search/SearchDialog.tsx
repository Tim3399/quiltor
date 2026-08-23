import { useMemo, useState } from "react";
import { Clock3, Command, FileText, MapPin, UserRound } from "lucide-react";
import {
  chapterBreadcrumb,
  manuscriptStructure,
  orderedChapters,
  type Manuscript,
} from "../manuscript";
import type { FigureState } from "../story-world";
import type { Workspace, WorkspaceTarget } from "../../shared";
import { CommandPalette, type CommandPaletteItem } from "../../shared/ui/CommandPalette";
import { kindLabel } from "../story-world";
import { useI18n } from "../../i18n";
import { textSearchRanges } from "../manuscript";

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
    const structure = manuscriptStructure(manuscript);
    const chapters: CommandPaletteItem[] = orderedChapters(manuscript).flatMap((chapter) => {
      const matches = textSearchRanges(chapter.body, needle);
      const metadataMatches = [chapter.title, chapter.note].some((value) =>
        value.toLocaleLowerCase().includes(needle.toLocaleLowerCase()),
      );
      if (needle && !matches.length && !metadataMatches) return [];
      const first = matches[0];
      const breadcrumb = chapterBreadcrumb(structure, chapter.id)
        .map((folder) => folder.title)
        .join(" / ");
      const matchDetail = first
        ? `${t("searchMatchCount", { count: matches.length })} · ${matchPreview(
            chapter.body,
            first.from,
            first.to,
          )}`
        : chapter.note || chapter.body.slice(0, 120);
      return [
        {
          id: `chapter-${chapter.id}`,
          label: chapter.title || t("untitled"),
          detail: [breadcrumb, matchDetail].filter(Boolean).join(" · "),
          keywords: [chapter.body, chapter.note, breadcrumb],
          icon: <FileText />,
          requiresQuery: true,
          onSelect: () => {
            onWorkspace("text");
            onSelect({
              workspace: "text",
              id: chapter.id,
              ...(first ? { textSearch: { query: needle, from: first.from, to: first.to } } : {}),
            });
          },
        },
      ];
    });
    const nodes: CommandPaletteItem[] = figures.nodes.map((node) => ({
      id: `node-${node.id}`,
      label: node.name,
      detail: node.sub || node.label || kindLabel(node.type ?? "person", t),
      keywords: [JSON.stringify(node)],
      icon: node.type === "ort" ? <MapPin /> : <UserRound />,
      requiresQuery: true,
      onSelect: () => {
        const targetWorkspace: Workspace = node.type === "ort" ? "places" : "figures";
        onWorkspace(targetWorkspace);
        onSelect({ workspace: targetWorkspace, id: node.id });
      },
    }));
    const moments: CommandPaletteItem[] = (figures.timeline || []).map((moment) => ({
      id: `moment-${moment.id}`,
      label: moment.title,
      detail: moment.note || moment.date || t("moment"),
      keywords: [JSON.stringify(moment)],
      icon: <Clock3 />,
      requiresQuery: true,
      onSelect: () => {
        onWorkspace("timeline");
        onSelect({ workspace: "timeline", id: moment.id });
      },
    }));
    return [...commands, ...chapters, ...nodes, ...moments];
  }, [manuscript, figures.nodes, figures.timeline, onCommand, onWorkspace, onSelect, query, t]);
  return (
    <CommandPalette
      open
      label={t("searchCommands")}
      inputLabel={t("searchTerm")}
      placeholder={t("searchPlaceholder")}
      emptyLabel={t("noSearchResults")}
      items={items}
      onClose={onClose}
      onQueryChange={setQuery}
    />
  );
}

function matchPreview(value: string, from: number, to: number) {
  const start = Math.max(0, from - 42),
    end = Math.min(value.length, to + 74);
  return `${start ? "…" : ""}${value.slice(start, end).replace(/\s+/g, " ").trim()}${
    end < value.length ? "…" : ""
  }`;
}
