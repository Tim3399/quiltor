import { Boxes, Building2, Lightbulb, MapPin, PawPrint, Users } from "lucide-react";
import { useMemo } from "react";
import { Button, SidePanel, SidePanelBody, SidePanelHeader } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureKind, FigureNode, FigureState } from "../model";
import { belongsOnFigureBoard } from "./figureCanvasModel";
import { kindLabel } from "./relationships";
import "./WorldOverviewPanel.css";

const KIND_ORDER: readonly FigureKind[] = [
  "person",
  "tier",
  "ort",
  "organisation",
  "objekt",
  "konzept",
];

const KIND_ICON = {
  person: Users,
  tier: PawPrint,
  ort: MapPin,
  organisation: Building2,
  objekt: Boxes,
  konzept: Lightbulb,
} as const;

export interface WorldOverviewPanelProps {
  state: FigureState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Bring the element into view on the canvas -- a double click, as in a file list. */
  onReveal: (node: FigureNode) => void;
}

/**
 * The structure column of the world: what exists, grouped by kind.
 *
 * The canvas answers how things relate, the inspector answers what one of them is. This
 * panel answers the question neither of them can while the surface is large: what is in
 * here at all, and where do I find it without hunting across the board.
 */
export function WorldOverviewPanel({
  state,
  selectedId,
  onSelect,
  onReveal,
}: WorldOverviewPanelProps) {
  const { t } = useI18n();
  // The same selection as on the canvas beside it: the overview is that canvas's table of
  // contents and must list nothing that is not there -- a double click otherwise jumped to a
  // node this board does not have at all.
  const elemente = useMemo(() => state.nodes.filter(belongsOnFigureBoard), [state.nodes]);
  const groups = useMemo(() => {
    const byKind = new Map<FigureKind, FigureNode[]>();
    for (const node of elemente) {
      const kind = node.type ?? "person";
      const bucket = byKind.get(kind);
      if (bucket) bucket.push(node);
      else byKind.set(kind, [node]);
    }
    return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
      kind,
      nodes: (byKind.get(kind) ?? [])
        .slice()
        .sort((left, right) => (left.name || "").localeCompare(right.name || "")),
    }));
  }, [elemente]);

  return (
    <SidePanel className="world-overview" label={t("worldOverviewLabel")} side="start" width="fill">
      <SidePanelHeader
        className="world-overview__header"
        title={t("nElements", { n: elemente.length })}
      />
      <SidePanelBody className="world-overview__body">
        {groups.map((group) => {
          const Icon = KIND_ICON[group.kind];
          return (
            <section className="world-overview__group" key={group.kind}>
              <h3 className="world-overview__group-title">
                <Icon aria-hidden="true" />
                <span>{kindLabel(group.kind, t)}</span>
                <small>{group.nodes.length}</small>
              </h3>
              <ul>
                {group.nodes.map((node) => (
                  <li key={node.id}>
                    <Button
                      className="world-overview__item"
                      appearance="ghost"
                      size="compact"
                      aria-current={node.id === selectedId ? "true" : undefined}
                      title={t("worldOverviewReveal")}
                      onClick={() => onSelect(node.id)}
                      onDoubleClick={() => {
                        onSelect(node.id);
                        onReveal(node);
                      }}
                    >
                      {node.name || t("untitled")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </SidePanelBody>
      <footer className="world-overview__footer">
        {t("nRelationships", { n: state.edges.length })}
      </footer>
    </SidePanel>
  );
}
