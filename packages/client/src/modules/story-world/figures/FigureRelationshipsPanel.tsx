import { Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import { GraphEdgeInspector, graphEdgeLineStyle, graphRelationshipKind } from "../../graph";
import type { FigureEdge, FigureNode, FigureState } from "../model";
import {
  patchRelationship,
  relationshipConflicts,
  relationshipLabelEditor,
  resolveRelationship,
} from "./relationships";

export function FigureRelationshipsPanel({
  figure,
  state,
  activeMomentId,
  onState,
  onRequestDelete,
}: {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onState: (state: FigureState) => void;
  onRequestDelete: (edge: FigureEdge, name: string) => void;
}) {
  const { t } = useI18n();
  const linked = state.edges.filter((edge) => edge.from === figure.id || edge.to === figure.id);

  return (
    <div className="relation-list">
      {linked.length ? (
        linked.map((edge) => {
          const resolved = resolveRelationship(edge, state.timeline || [], activeMomentId);
          const labelEditor = relationshipLabelEditor(edge, state.timeline || [], activeMomentId);
          const otherId = resolved.from === figure.id ? resolved.to : resolved.from;
          const other = state.nodes.find((node) => node.id === otherId);
          const sourceName =
            state.nodes.find((node) => node.id === resolved.from)?.name || t("unknown");
          const targetName =
            state.nodes.find((node) => node.id === resolved.to)?.name || t("unknown");
          const patchEdge = (patch: Partial<FigureEdge>) =>
            onState({
              ...state,
              edges: state.edges.map((item) =>
                item.id === edge.id
                  ? patchRelationship(item, state.timeline || [], activeMomentId, patch)
                  : item,
              ),
            });
          const toggleDirectionConflict = relationshipConflicts(
            state.edges,
            state.timeline || [],
            activeMomentId,
            edge.id,
            {
              from: resolved.from,
              to: resolved.to,
              gerichtet: !resolved.gerichtet,
            },
          );
          const reverseDirectionConflict = resolved.gerichtet
            ? relationshipConflicts(state.edges, state.timeline || [], activeMomentId, edge.id, {
                from: resolved.to,
                to: resolved.from,
                gerichtet: true,
              })
            : false;
          const directionLabel = t("reverseDirectionTo")
            .replace("{from}", sourceName)
            .replace("{to}", targetName);
          return (
            <div key={edge.id} className={!resolved.active ? "outside-moment" : ""}>
              <GraphEdgeInspector
                sourceLabel={sourceName}
                targetLabel={targetName}
                value={labelEditor.value}
                directed={resolved.gerichtet === true}
                lineStyle={graphEdgeLineStyle(resolved)}
                color={resolved.color ?? (resolved.style === "gold" ? "gold" : "auto")}
                labels={{
                  title: t("relationship"),
                  label: t("relationToName").replace("{name}", other?.name || ""),
                  labelPlaceholder: t("nameRelationship"),
                  directed: t("directed"),
                  reverse: directionLabel,
                  conflict: t("relationConflict"),
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
                labelPlaceholder={labelEditor.inherited || t("nameRelationship")}
                disabled={!resolved.active}
                toggleConflict={toggleDirectionConflict}
                reverseConflict={reverseDirectionConflict}
                onLabelChange={(label) => patchEdge({ label })}
                onDirectedChange={(gerichtet) => patchEdge({ gerichtet })}
                onLineStyleChange={(lineStyle) => patchEdge({ lineStyle })}
                onColorChange={(color) => patchEdge({ color })}
                onReverse={() => patchEdge({ from: resolved.to, to: resolved.from })}
                semanticControls={
                  <>
                    <Checkbox
                      containerClassName="check-field"
                      label={t("kinship")}
                      hint={t("kinshipHint")}
                      checked={graphRelationshipKind(resolved) === "kinship"}
                      disabled={!resolved.active}
                      onChange={(event) =>
                        patchEdge({
                          relationshipKind: event.target.checked ? "kinship" : "general",
                        })
                      }
                    />
                    {activeMomentId && (
                      <>
                        <small>{resolved.active ? t("appliesHere") : t("notActiveHere")}</small>
                        <Button
                          className="relation-toggle"
                          onClick={() => patchEdge({ active: !resolved.active })}
                        >
                          {resolved.active ? t("relationEndsHere") : t("relationStartsHere")}
                        </Button>
                      </>
                    )}
                    <IconButton
                      className="relationship-delete-action"
                      tone="danger"
                      label={t("deleteConnection")}
                      icon={<Trash2 />}
                      onClick={() => onRequestDelete(edge, other?.name || t("unknown"))}
                    />
                  </>
                }
              />
            </div>
          );
        })
      ) : (
        <p className="muted">{t("noRelationshipsYet")}</p>
      )}
    </div>
  );
}
