import { useState } from "react";
import { useI18n } from "../../i18n";
import { Dialog } from "../../shared/ui/Dialog";
import { SelectControl } from "../../shared/ui/SelectControl";
import type { FigureKind, FigureState } from "../story-world";
import type { AssistantProposal } from "./model";

const ELEMENT_TYPES: FigureKind[] = ["person", "tier", "ort", "organisation", "objekt", "konzept"];

export function AssistantProposalEditor({
  proposal,
  figures,
  onSave,
  onClose,
}: {
  proposal: AssistantProposal;
  figures: FigureState;
  onSave: (proposal: AssistantProposal) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AssistantProposal>(() => structuredClone(proposal));
  const nodes = figures.nodes.map((node) => ({ value: node.id, label: node.name || node.id }));
  const places = figures.nodes
    .filter((node) => node.type === "ort")
    .map((node) => ({ value: node.id, label: node.name || node.id }));
  const moments = (figures.timeline || []).map((moment) => ({
    value: moment.id,
    label: moment.title || moment.id,
  }));
  const relationships = figures.edges.map((edge) => ({
    value: edge.id,
    label: edge.label || `${edge.from} → ${edge.to}`,
  }));

  const textField = (
    label: string,
    value: string | undefined,
    onChange: (value: string) => void,
    multiline = false,
  ) => (
    <label className="assistant-edit-field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value || ""} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );

  return (
    <Dialog title={t("editProposal")} onClose={onClose}>
      <div className="assistant-proposal-editor">
        {draft.kind === "create_element" && (
          <>
            {textField(t("proposalName"), draft.element.name, (name) =>
              setDraft({ ...draft, element: { ...draft.element, name } }),
            )}
            <div className="assistant-edit-field">
              <span>{t("proposalElement")}</span>
              <SelectControl
                label={t("proposalElement")}
                value={draft.element.type || "person"}
                options={ELEMENT_TYPES.map((value) => ({ value, label: value }))}
                onChange={(type) => setDraft({ ...draft, element: { ...draft.element, type } })}
              />
            </div>
            {textField(t("proposalLabel"), draft.element.label, (label) =>
              setDraft({ ...draft, element: { ...draft.element, label } }),
            )}
            {textField(
              t("proposalDescription"),
              draft.element.sub,
              (sub) => setDraft({ ...draft, element: { ...draft.element, sub } }),
              true,
            )}
            {textField(
              t("proposalAliases"),
              (draft.element.aliases || []).map((item) => item.alias).join(", "),
              (value) =>
                setDraft({
                  ...draft,
                  element: {
                    ...draft.element,
                    aliases: value
                      .split(",")
                      .map((alias) => alias.trim())
                      .filter(Boolean)
                      .map((alias) => ({ alias, source: "assistant" })),
                  },
                }),
            )}
          </>
        )}
        {draft.kind === "update_element" && (
          <>
            {textField(t("proposalName"), draft.patch.name, (name) =>
              setDraft({ ...draft, patch: { ...draft.patch, name } }),
            )}
            {textField(t("proposalLabel"), draft.patch.label, (label) =>
              setDraft({ ...draft, patch: { ...draft.patch, label } }),
            )}
            {textField(
              t("proposalDescription"),
              draft.patch.sub,
              (sub) => setDraft({ ...draft, patch: { ...draft.patch, sub } }),
              true,
            )}
            {textField(
              t("proposalAliases"),
              (draft.patch.aliases || []).map((item) => item.alias).join(", "),
              (value) =>
                setDraft({
                  ...draft,
                  patch: {
                    ...draft.patch,
                    aliases: value
                      .split(",")
                      .map((alias) => alias.trim())
                      .filter(Boolean)
                      .map((alias) => ({ alias, source: "assistant" })),
                  },
                }),
            )}
          </>
        )}
        {draft.kind === "create_timeline_moment" && (
          <>
            {textField(t("proposalTitle"), draft.moment.title, (title) =>
              setDraft({ ...draft, moment: { ...draft.moment, title } }),
            )}
            {textField(t("proposalDate"), draft.moment.date, (date) =>
              setDraft({ ...draft, moment: { ...draft.moment, date } }),
            )}
            {textField(
              t("proposalNote"),
              draft.moment.note,
              (note) => setDraft({ ...draft, moment: { ...draft.moment, note } }),
              true,
            )}
          </>
        )}
        {draft.kind === "create_relationship" && (
          <>
            <SelectionField
              label={t("proposalFrom")}
              value={draft.relationship.from}
              options={nodes}
              onChange={(from) =>
                setDraft({ ...draft, relationship: { ...draft.relationship, from } })
              }
            />
            <SelectionField
              label={t("proposalTo")}
              value={draft.relationship.to}
              options={nodes}
              onChange={(to) => setDraft({ ...draft, relationship: { ...draft.relationship, to } })}
            />
            {textField(t("proposalLabel"), draft.relationship.label, (label) =>
              setDraft({ ...draft, relationship: { ...draft.relationship, label } }),
            )}
            <button
              type="button"
              className="assistant-edit-checkbox"
              role="checkbox"
              aria-checked={Boolean(draft.relationship.directed)}
              onClick={() =>
                setDraft({
                  ...draft,
                  relationship: {
                    ...draft.relationship,
                    directed: !draft.relationship.directed,
                  },
                })
              }
            >
              <span aria-hidden="true" className="assistant-edit-checkmark" />
              <span>{t("proposalDirected")}</span>
            </button>
          </>
        )}
        {draft.kind === "set_relationship_at_moment" && (
          <>
            <SelectionField
              label={t("proposalGroupRelationships")}
              value={draft.relationshipId}
              options={relationships}
              onChange={(relationshipId) => setDraft({ ...draft, relationshipId })}
            />
            <SelectionField
              label={t("proposalMoment")}
              value={draft.momentId}
              options={moments}
              onChange={(momentId) => setDraft({ ...draft, momentId })}
            />
            {textField(t("proposalLabel"), draft.patch.label, (label) =>
              setDraft({ ...draft, patch: { ...draft.patch, label } }),
            )}
          </>
        )}
        {draft.kind === "mark_deceased" && (
          <>
            <SelectionField
              label={t("proposalElement")}
              value={draft.elementId}
              options={nodes}
              onChange={(elementId) => setDraft({ ...draft, elementId })}
            />
            <SelectionField
              label={t("proposalMoment")}
              value={draft.momentId}
              options={moments}
              onChange={(momentId) => setDraft({ ...draft, momentId })}
            />
          </>
        )}
        {draft.kind === "set_presence" && (
          <>
            <SelectionField
              label={t("proposalElement")}
              value={draft.elementId}
              options={nodes}
              onChange={(elementId) => setDraft({ ...draft, elementId })}
            />
            <SelectionField
              label={t("proposalPlace")}
              value={draft.placeId}
              options={places}
              onChange={(placeId) => setDraft({ ...draft, placeId })}
            />
            {!!moments.length && (
              <SelectionField
                label={t("proposalMoment")}
                value={draft.momentId || moments[0].value}
                options={moments}
                onChange={(momentId) => setDraft({ ...draft, momentId })}
              />
            )}
          </>
        )}
        <div className="assistant-edit-actions">
          <button type="button" onClick={onClose}>
            {t("cancelProposalEdit")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t("saveProposalEdit")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function SelectionField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="assistant-edit-field">
      <span>{label}</span>
      <SelectControl label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}
