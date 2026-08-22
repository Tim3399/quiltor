import { Pin, Plus, Skull, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../../i18n";
import { normalizeEntityAliasV1 } from "../../../shared";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { SelectControl } from "../../../shared/ui/SelectControl";
import type {
  EntityAlias,
  FigureEdge,
  FigureKind,
  FigureNode,
  FigureState,
  Profile,
} from "../model";
import { PresenceField } from "./PresenceField";
import { PROFILE_FIELDS } from "./profileFields";
import {
  kindLabel,
  patchRelationship,
  relationshipLabelEditor,
  resolveRelationship,
} from "./relationships";
import "./FigureInspector.css";

export type FigureInspectorProps = {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onPatch: (patch: Partial<FigureNode>) => void;
  onState: (state: FigureState) => void;
  onDelete: () => void;
  onSelectMoment: (id: string | null) => void;
};

type AliasError = "aliasRequired" | "aliasMatchesName" | "aliasDuplicate";

const ALIAS_SOURCE_KEYS = {
  manual: "aliasSourceManual",
  manuscript: "aliasSourceManuscript",
  assistant: "aliasSourceAssistant",
  import: "aliasSourceImport",
} as const;

function validateAlias(
  value: string,
  figure: FigureNode,
  ignoredAlias?: EntityAlias,
): AliasError | null {
  const normalized = normalizeEntityAliasV1(value.trim());
  if (!normalized) return "aliasRequired";
  if (normalized === normalizeEntityAliasV1(figure.name)) return "aliasMatchesName";
  if (
    (figure.aliases || []).some(
      (alias) => alias !== ignoredAlias && normalizeEntityAliasV1(alias.alias) === normalized,
    )
  )
    return "aliasDuplicate";
  return null;
}

function AliasRow({
  alias,
  figure,
  onPatch,
}: {
  alias: EntityAlias;
  figure: FigureNode;
  onPatch: (patch: Partial<FigureNode>) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(alias.alias);
  const [error, setError] = useState<AliasError | null>(null);
  const aliases = figure.aliases || [];
  const index = aliases.indexOf(alias);
  const errorId = `figure-alias-${figure.id}-${index}-error`;

  const commit = () => {
    const value = draft.trim();
    const nextError = validateAlias(value, figure, alias);
    setError(nextError);
    if (nextError || value === alias.alias) return;
    onPatch({
      aliases: aliases.map((item) => (item === alias ? { ...item, alias: value } : item)),
    });
  };

  return (
    <div className="alias-row">
      <div className="alias-input-wrap">
        <input
          aria-label={t("editAlias").replace("{alias}", alias.alias)}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraft(alias.alias);
              setError(null);
              event.currentTarget.blur();
            }
          }}
        />
        <small>{t(ALIAS_SOURCE_KEYS[alias.source || "manual"])}</small>
      </div>
      <button
        type="button"
        className="icon-button danger-text"
        aria-label={t("removeAlias").replace("{alias}", alias.alias)}
        onClick={() => onPatch({ aliases: aliases.filter((item) => item !== alias) })}
      >
        <Trash2 />
      </button>
      {error && (
        <small id={errorId} className="alias-error" role="alert">
          {t(error)}
        </small>
      )}
    </div>
  );
}

function AliasEditor({
  figure,
  onPatch,
}: {
  figure: FigureNode;
  onPatch: (patch: Partial<FigureNode>) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<AliasError | null>(null);
  const aliases = figure.aliases || [];
  const errorId = `figure-alias-${figure.id}-new-error`;

  const cancel = () => {
    setAdding(false);
    setDraft("");
    setError(null);
  };
  const add = () => {
    const value = draft.trim();
    const nextError = validateAlias(value, figure);
    setError(nextError);
    if (nextError) return;
    onPatch({ aliases: [...aliases, { alias: value, source: "manual" }] });
    cancel();
  };

  return (
    <section className="alias-editor" aria-labelledby={`figure-aliases-${figure.id}`}>
      <div className="alias-heading">
        <div>
          <h3 id={`figure-aliases-${figure.id}`}>{t("aliases")}</h3>
          <p>{t("aliasesHint")}</p>
        </div>
        {!adding && (
          <button type="button" className="alias-add" onClick={() => setAdding(true)}>
            <Plus />
            {t("addAlias")}
          </button>
        )}
      </div>
      {aliases.map((alias) => (
        <AliasRow
          key={normalizeEntityAliasV1(alias.alias)}
          alias={alias}
          figure={figure}
          onPatch={onPatch}
        />
      ))}
      {adding && (
        <div className="alias-row alias-new-row">
          <div className="alias-input-wrap">
            <input
              autoFocus
              aria-label={t("newAlias")}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              placeholder={t("aliasPlaceholder")}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Escape") cancel();
              }}
            />
            <small>{t("aliasSourceManual")}</small>
          </div>
          <div className="alias-new-actions">
            <button type="button" className="icon-button" aria-label={t("saveAlias")} onClick={add}>
              <Plus />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t("cancelAlias")}
              onClick={cancel}
            >
              <Trash2 />
            </button>
          </div>
          {error && (
            <small id={errorId} className="alias-error" role="alert">
              {t(error)}
            </small>
          )}
        </div>
      )}
    </section>
  );
}

export function FigureInspector({
  figure,
  state,
  activeMomentId,
  onPatch,
  onState,
  onDelete,
  onSelectMoment,
}: FigureInspectorProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"card" | "profile" | "links">("card");
  // Deleting a relationship also drops every version it carries at individual moments, which the
  // row itself does not show -- so it asks first, at the same level as deleting an element.
  const [deleteEdge, setDeleteEdge] = useState<{ edge: FigureEdge; name: string } | null>(null);
  const profile = figure.profile || { extra: [] };
  const patchProfile = (patch: Partial<Profile>) => onPatch({ profile: { ...profile, ...patch } });
  const linked = state.edges.filter((edge) => edge.from === figure.id || edge.to === figure.id);
  return (
    <>
      <div className="panel-tabs three" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "card"}
          onClick={() => setTab("card")}
        >
          {t("card")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "profile"}
          onClick={() => setTab("profile")}
        >
          {t("profile")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "links"}
          onClick={() => setTab("links")}
        >
          {t("relationships")}
        </button>
      </div>
      <div className="panel-body">
        {tab === "card" && (
          <>
            <label className="field">
              <span>{t("kind")}</span>
              <SelectControl<FigureKind>
                label={t("kind")}
                value={figure.type || "person"}
                options={[
                  { value: "person", label: t("figure") },
                  { value: "tier", label: t("animal") },
                  { value: "ort", label: t("place") },
                  { value: "organisation", label: t("organisation") },
                  { value: "objekt", label: t("object") },
                  { value: "konzept", label: t("concept") },
                ]}
                onChange={(type) => onPatch({ type })}
              />
            </label>
            <label className="field">
              <span>{t("name")}</span>
              <input
                value={figure.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
            <AliasEditor figure={figure} onPatch={onPatch} />
            <label className="field">
              <span>{t("category")}</span>
              <input
                value={figure.label || ""}
                onChange={(event) => onPatch({ label: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("shortDescription")}</span>
              <textarea
                value={figure.sub || ""}
                onChange={(event) => onPatch({ sub: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("accent")}</span>
              <SelectControl<NonNullable<FigureNode["accent"]>>
                label={t("accent")}
                value={figure.accent || "ink"}
                options={[
                  { value: "ink", label: t("neutral") },
                  { value: "gold", label: t("gold") },
                  { value: "rose", label: t("rose") },
                  { value: "moss", label: t("green") },
                ]}
                onChange={(accent) => onPatch({ accent })}
              />
            </label>
            <div className="node-priority-actions">
              <button
                type="button"
                className={figure.important ? "active" : ""}
                aria-pressed={!!figure.important}
                onClick={() => onPatch({ important: !figure.important })}
              >
                <Star />
                {figure.important ? t("unmarkImportant") : t("markImportant")}
              </button>
              <button
                type="button"
                className={figure.pinned ? "active" : ""}
                aria-pressed={!!figure.pinned}
                onClick={() => onPatch({ pinned: !figure.pinned })}
              >
                <Pin />
                {figure.pinned ? t("unpinPosition") : t("pinPosition")}
              </button>
            </div>
            {activeMomentId && figure.type !== "ort" && figure.type !== "konzept" && (
              <button
                type="button"
                className={`timeline-life-action ${figure.diedMomentId === activeMomentId ? "active" : ""}`}
                onClick={() =>
                  onPatch({
                    diedMomentId:
                      figure.diedMomentId === activeMomentId ? undefined : activeMomentId,
                  })
                }
              >
                <Skull />
                {figure.diedMomentId === activeMomentId ? t("removeDeathMarker") : t("diesHere")}
              </button>
            )}
            {(figure.type === "person" || figure.type === "tier") && (
              <PresenceField
                figure={figure}
                state={state}
                activeMomentId={activeMomentId}
                onState={onState}
                onSelectMoment={onSelectMoment}
              />
            )}
          </>
        )}
        {tab === "profile" && (
          <>
            {PROFILE_FIELDS.map(([key, label, size]) => (
              <label
                className="field"
                key={key as string}
                htmlFor={`figure-profile-${figure.id}-${String(key)}`}
              >
                <span>{t(label)}</span>
                {size === "short" ? (
                  <input
                    id={`figure-profile-${figure.id}-${String(key)}`}
                    value={String(profile[key] || "")}
                    onChange={(event) => patchProfile({ [key]: event.target.value })}
                  />
                ) : (
                  <textarea
                    id={`figure-profile-${figure.id}-${String(key)}`}
                    value={String(profile[key] || "")}
                    onChange={(event) => patchProfile({ [key]: event.target.value })}
                  />
                )}
              </label>
            ))}
            <h3 className="section-label">{t("customFields")}</h3>
            {(profile.extra || []).map((field, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Profile extras have no persistent id and their stored order is their identity.
              <div className="custom-field" key={index}>
                <input
                  aria-label={t("fieldName")}
                  placeholder={t("fieldName")}
                  value={field.k}
                  onChange={(event) =>
                    patchProfile({
                      extra: (profile.extra || []).map((item, i) =>
                        i === index ? { ...item, k: event.target.value } : item,
                      ),
                    })
                  }
                />
                <textarea
                  aria-label={`${field.k || t("customField")} ${t("content")}`}
                  placeholder={t("content")}
                  value={field.v}
                  onChange={(event) =>
                    patchProfile({
                      extra: (profile.extra || []).map((item, i) =>
                        i === index ? { ...item, v: event.target.value } : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-button danger-text"
                  aria-label={t("removeCustomField")}
                  onClick={() =>
                    patchProfile({ extra: (profile.extra || []).filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-action"
              onClick={() => patchProfile({ extra: [...(profile.extra || []), { k: "", v: "" }] })}
            >
              <Plus />
              {t("customField")}
            </button>
          </>
        )}
        {tab === "links" && (
          <div className="relation-list">
            {linked.length ? (
              linked.map((edge) => {
                const resolved = resolveRelationship(edge, state.timeline || [], activeMomentId);
                const labelEditor = relationshipLabelEditor(
                  edge,
                  state.timeline || [],
                  activeMomentId,
                );
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
                        <button
                          type="button"
                          className="relation-direction"
                          aria-label={directionLabel}
                          title={directionLabel}
                          disabled={!resolved.active}
                          onClick={() => patchEdge({ from: resolved.to, to: resolved.from })}
                        >
                          {resolved.from === figure.id ? "→" : "←"}
                        </button>
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
                    <label className="relationship-label-editor">
                      <span className="sr-only">
                        {t("relationToName").replace("{name}", other?.name || "")}
                      </span>
                      <input
                        aria-label={t("relationToName").replace("{name}", other?.name || "")}
                        value={labelEditor.value}
                        placeholder={labelEditor.inherited || t("nameRelationship")}
                        disabled={!resolved.active}
                        onChange={(event) => patchEdge({ label: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button danger-text"
                      aria-label={t("deleteConnection")}
                      onClick={() => setDeleteEdge({ edge, name: other?.name || t("unknown") })}
                    >
                      <Trash2 />
                    </button>
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
                      <SelectControl<NonNullable<FigureEdge["style"]>>
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
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={!!resolved.gerichtet}
                        disabled={!resolved.active}
                        onChange={(event) => patchEdge({ gerichtet: event.target.checked })}
                      />
                      {t("directed")}
                    </label>
                    {activeMomentId && (
                      <button
                        type="button"
                        className="relation-toggle"
                        onClick={() => patchEdge({ active: !resolved.active })}
                      >
                        {resolved.active ? t("relationEndsHere") : t("relationStartsHere")}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="muted">{t("noRelationshipsYet")}</p>
            )}
          </div>
        )}
        <button type="button" className="danger-text inspector-delete" onClick={onDelete}>
          <Trash2 />
          {t("deleteKind").replace("{kind}", kindLabel(figure.type, t))}
        </button>
      </div>
      {deleteEdge && (
        <ConfirmDialog
          title={t("deleteConnection")}
          description={t("deleteConnectionDescription", { name: deleteEdge.name })}
          confirmLabel={t("deleteConnection")}
          undoable
          onConfirm={() =>
            onState({
              ...state,
              edges: state.edges.filter((item) => item.id !== deleteEdge.edge.id),
            })
          }
          onClose={() => setDeleteEdge(null)}
        />
      )}
    </>
  );
}
