import { Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton, ListboxSelect, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureEdge, FigureNode, FigureState } from "../model";
import { patchRelationship, relationshipLabelEditor, resolveRelationship } from "./relationships";

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
          const patchEdge = (patch: Partial<FigureEdge>) =>
            onState({
              ...state,
              edges: state.edges.map((item) =>
                item.id === edge.id
                  ? patchRelationship(item, state.timeline || [], activeMomentId, patch)
                  : item,
              ),
            });
          const directionLabel = t("reverseDirectionTo")
            .replace(
              "{from}",
              state.nodes.find((node) => node.id === resolved.from)?.name || t("unknown"),
            )
            .replace(
              "{to}",
              state.nodes.find((node) => node.id === resolved.to)?.name || t("unknown"),
            );
          return (
            <div key={edge.id} className={!resolved.active ? "outside-moment" : ""}>
              <div>
                {resolved.gerichtet ? (
                  <Button
                    className="relation-direction"
                    appearance="ghost"
                    size="compact"
                    aria-label={directionLabel}
                    title={directionLabel}
                    disabled={!resolved.active}
                    onClick={() => patchEdge({ from: resolved.to, to: resolved.from })}
                  >
                    {resolved.from === figure.id ? "→" : "←"}
                  </Button>
                ) : (
                  <span
                    role="img"
                    className="relation-undirected"
                    aria-label={t("undirectedRelation")}
                    title={t("undirectedRelation")}
                  >
                    ↔
                  </span>
                )}
                <strong>{other?.name || t("unknown")}</strong>
                {activeMomentId && (
                  <small>{resolved.active ? t("appliesHere") : t("notActiveHere")}</small>
                )}
              </div>
              <TextField
                fieldClassName="relationship-label-editor"
                className="relationship-label-input"
                label={t("relationToName").replace("{name}", other?.name || "")}
                labelHidden
                value={labelEditor.value}
                placeholder={labelEditor.inherited || t("nameRelationship")}
                disabled={!resolved.active}
                onChange={(event) => patchEdge({ label: event.target.value })}
              />
              <IconButton
                className="relationship-delete-action"
                tone="danger"
                label={t("deleteConnection")}
                icon={<Trash2 />}
                onClick={() => onRequestDelete(edge, other?.name || t("unknown"))}
              />
              <fieldset
                className="relationship-style-control"
                disabled={!resolved.active}
                onClickCapture={(event) => {
                  if (!resolved.active) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onKeyDownCapture={(event) => {
                  if (!resolved.active) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
              >
                <ListboxSelect<NonNullable<FigureEdge["style"]>>
                  className="relationship-style-select"
                  label={t("lineStyle")}
                  value={resolved.style || "solid"}
                  options={[
                    { value: "solid", label: t("normal") },
                    { value: "dashed", label: t("dashed") },
                    { value: "blood", label: t("bloodline") },
                    { value: "gold", label: t("gold") },
                  ]}
                  onChange={(style) => patchEdge({ style })}
                />
              </fieldset>
              <Checkbox
                containerClassName="check-field"
                label={t("directed")}
                checked={!!resolved.gerichtet}
                disabled={!resolved.active}
                onChange={(event) => patchEdge({ gerichtet: event.target.checked })}
              />
              {activeMomentId && (
                <Button
                  className="relation-toggle"
                  onClick={() => patchEdge({ active: !resolved.active })}
                >
                  {resolved.active ? t("relationEndsHere") : t("relationStartsHere")}
                </Button>
              )}
            </div>
          );
        })
      ) : (
        <p className="muted">{t("noRelationshipsYet")}</p>
      )}
    </div>
  );
}
