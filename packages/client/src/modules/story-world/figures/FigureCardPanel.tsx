import { Plus, Skull, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, ListboxSelect, TextArea, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import { normalizeEntityAliasV1 } from "../../../shared";
import type { EntityAlias, FigureKind, FigureNode, FigureState } from "../model";
import { NodePriorityActions } from "../NodePriorityActions";
import { PresenceField } from "./PresenceField";

type AliasError = "aliasRequired" | "aliasMatchesName" | "aliasDuplicate";

const ALIAS_SOURCE_KEYS = {
  manual: "aliasSourceManual",
  manuscript: "aliasSourceManuscript",
  assistant: "aliasSourceAssistant",
  import: "aliasSourceImport",
} as const;

export function validateFigureAlias(
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
    const nextError = validateFigureAlias(value, figure, alias);
    setError(nextError);
    if (nextError || value === alias.alias) return;
    onPatch({
      aliases: aliases.map((item) => (item === alias ? { ...item, alias: value } : item)),
    });
  };

  return (
    <div className="alias-row">
      <div className="alias-input-wrap">
        <TextField
          fieldClassName="alias-text-field"
          className="alias-input"
          label={t("editAlias").replace("{alias}", alias.alias)}
          labelHidden
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
      <IconButton
        className="alias-remove"
        tone="danger"
        label={t("removeAlias").replace("{alias}", alias.alias)}
        icon={<Trash2 />}
        onClick={() => onPatch({ aliases: aliases.filter((item) => item !== alias) })}
      />
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
    const nextError = validateFigureAlias(value, figure);
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
          <Button
            className="alias-add"
            size="compact"
            icon={<Plus />}
            onClick={() => setAdding(true)}
          >
            {t("addAlias")}
          </Button>
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
            <TextField
              fieldClassName="alias-text-field"
              className="alias-input"
              autoFocus
              label={t("newAlias")}
              labelHidden
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
            <IconButton label={t("saveAlias")} icon={<Plus />} onClick={add} />
            <IconButton label={t("cancelAlias")} icon={<Trash2 />} onClick={cancel} />
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

export interface FigureCardPanelProps {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onPatch: (patch: Partial<FigureNode>) => void;
  onState: (state: FigureState) => void;
  onSelectMoment: (id: string | null) => void;
}

export function FigureCardPanel({
  figure,
  state,
  activeMomentId,
  onPatch,
  onState,
  onSelectMoment,
}: FigureCardPanelProps) {
  const { t } = useI18n();
  const [nameDraft, setNameDraft] = useState(figure.name);
  const nameDraftOwnerId = useRef(figure.id);
  const skipNameCommit = useRef(false);

  useEffect(() => {
    const ownerChanged = nameDraftOwnerId.current !== figure.id;
    nameDraftOwnerId.current = figure.id;
    skipNameCommit.current = false;
    setNameDraft((current) => (ownerChanged || current !== figure.name ? figure.name : current));
  }, [figure.id, figure.name]);

  const commitName = () => {
    if (skipNameCommit.current) {
      skipNameCommit.current = false;
      return;
    }
    if (nameDraft === figure.name) return;
    onPatch({ name: nameDraft });
  };

  return (
    <>
      <div className="figure-card-select-field">
        <span>{t("kind")}</span>
        <ListboxSelect<FigureKind>
          className="figure-card-select"
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
      </div>
      <TextField
        fieldClassName="figure-card-field"
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
            setNameDraft(figure.name);
            event.currentTarget.blur();
          }
        }}
      />
      <AliasEditor figure={figure} onPatch={onPatch} />
      <TextField
        fieldClassName="figure-card-field"
        label={t("category")}
        value={figure.label || ""}
        onChange={(event) => onPatch({ label: event.target.value })}
      />
      <TextArea
        fieldClassName="figure-card-field"
        label={t("shortDescription")}
        value={figure.sub || ""}
        onChange={(event) => onPatch({ sub: event.target.value })}
      />
      <NodePriorityActions
        important={!!figure.important}
        pinned={!!figure.pinned}
        importantLabel={figure.important ? t("unmarkImportant") : t("markImportant")}
        pinnedLabel={figure.pinned ? t("unpinPosition") : t("pinPosition")}
        onImportantChange={(important) => onPatch({ important })}
        onPinnedChange={(pinned) => onPatch({ pinned })}
      />
      {activeMomentId && figure.type !== "ort" && figure.type !== "konzept" && (
        <Button
          className={`timeline-life-action ${figure.diedMomentId === activeMomentId ? "active" : ""}`}
          icon={<Skull />}
          onClick={() =>
            onPatch({
              diedMomentId: figure.diedMomentId === activeMomentId ? undefined : activeMomentId,
            })
          }
        >
          {figure.diedMomentId === activeMomentId ? t("removeDeathMarker") : t("diesHere")}
        </Button>
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
  );
}
