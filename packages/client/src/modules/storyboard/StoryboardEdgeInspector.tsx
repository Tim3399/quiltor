import { useI18n } from "../../i18n";
import { type GraphEdgeColor, GraphEdgeInspector, type GraphEdgeLineStyle } from "../graph";
import type { StoryboardEdge } from "./model";

export function StoryboardEdgeInspector({
  edge,
  sourceLabel,
  targetLabel,
  toggleConflict,
  reverseConflict,
  onLabelChange,
  onDirectedChange,
  onLineStyleChange,
  onColorChange,
  onReverse,
}: {
  edge: StoryboardEdge;
  sourceLabel: string;
  targetLabel: string;
  toggleConflict: boolean;
  reverseConflict: boolean;
  onLabelChange: (label: string) => void;
  onDirectedChange: (directed: boolean) => void;
  onLineStyleChange: (lineStyle: GraphEdgeLineStyle) => void;
  onColorChange: (color: GraphEdgeColor) => void;
  onReverse: () => void;
}) {
  const { t } = useI18n();
  return (
    <GraphEdgeInspector
      sourceLabel={sourceLabel}
      targetLabel={targetLabel}
      value={edge.label ?? ""}
      directed={edge.directed === true}
      lineStyle={edge.lineStyle ?? "solid"}
      color={edge.color ?? "auto"}
      labels={{
        title: t("storyboardEdgeInspectorTitle"),
        label: t("storyboardEdgeLabel"),
        labelPlaceholder: t("storyboardEdgeLabelPlaceholder"),
        directed: t("storyboardEdgeDirected"),
        reverse: t("storyboardEdgeReverse"),
        conflict: t("storyboardEdgeConflict"),
        lineStyle: t("edgeLineStyle"),
        lineStyleOptions: {
          solid: t("edgeLineSolid"),
          dashed: t("edgeLineDashed"),
          dotted: t("edgeLineDotted"),
        },
        color: t("edgeColor"),
        colorOptions: {
          auto: t("edgeColorAuto"),
          ink: t("edgeColorInk"),
          gold: t("edgeColorGold"),
          rose: t("edgeColorRose"),
          moss: t("edgeColorMoss"),
          blue: t("edgeColorBlue"),
        },
      }}
      toggleConflict={toggleConflict}
      reverseConflict={reverseConflict}
      onLabelChange={onLabelChange}
      onDirectedChange={onDirectedChange}
      onLineStyleChange={onLineStyleChange}
      onColorChange={onColorChange}
      onReverse={onReverse}
    />
  );
}
