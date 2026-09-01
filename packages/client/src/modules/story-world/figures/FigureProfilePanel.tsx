import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  TextArea,
  TextField,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import { NoteEditor, noteFocusCopy } from "../../notes";
import type { FigureNode, Profile } from "../model";
import { normalizeProfile } from "../profile";
import { FigureBacklinksSection } from "./FigureBacklinksSection";
import { PROFILE_FIELD_TEMPLATES } from "./profileFields";

export function FigureProfilePanel({
  figure,
  onPatch,
}: {
  figure: FigureNode;
  onPatch: (patch: Partial<FigureNode>) => void;
}) {
  const { t } = useI18n();
  const profile = figure.profile || { fields: [] };
  const canonicalProfile = normalizeProfile(profile, figure.id, (legacyKey) => {
    const template = PROFILE_FIELD_TEMPLATES.find((item) => item.legacyKey === legacyKey);
    return template ? t(template.label) : legacyKey;
  });
  const fields = canonicalProfile.fields || [];
  const patchProfile = (patch: Partial<Profile>) =>
    onPatch({ profile: { ...canonicalProfile, ...patch } });
  const patchFields = (nextFields: Profile["fields"]) => patchProfile({ fields: nextFields });
  const hasTemplate = (legacyKey: string, label: string) =>
    fields.some(
      (field) =>
        field.id === `profile-field:${figure.id}:legacy:${legacyKey}` ||
        field.key.trim().localeCompare(label.trim(), undefined, { sensitivity: "accent" }) === 0,
    );
  const addField = (key: string) => patchFields([...fields, { id: uid("pf"), key, value: "" }]);

  return (
    <>
      <NoteEditor
        owner={{ kind: figure.type === "ort" ? "place" : "entity", id: figure.id }}
        fieldClassName="figure-profile-notes-field"
        className="figure-profile-notes-control"
        label={t("profileNotes")}
        value={profile.notizen || ""}
        references={profile.noteReferences}
        marks={profile.noteMarks}
        onChange={(notizen, noteReferences, noteMarks) =>
          patchProfile({ notizen, noteReferences, noteMarks })
        }
        focus={noteFocusCopy(t, figure.name)}
        rows={9}
      />
      <FigureBacklinksSection figure={figure} />
      <section className="figure-profile-fields" aria-labelledby={`figure-fields-${figure.id}`}>
        <div className="figure-profile-fields-heading">
          <div className="figure-profile-fields-copy">
            <h3 id={`figure-fields-${figure.id}`}>{t("profileFields")}</h3>
            <p>{t("profileFieldsHint")}</p>
          </div>
          <DropdownMenu
            label={t("addProfileField")}
            header={<strong>{t("recommendedProfileFields")}</strong>}
            renderTrigger={({ ref, ...triggerProps }) => (
              <Button
                {...triggerProps}
                ref={ref}
                className="figure-profile-field-add"
                size="compact"
                icon={<Plus />}
              >
                {t("addProfileField")}
              </Button>
            )}
          >
            {PROFILE_FIELD_TEMPLATES.map((template) => {
              const label = t(template.label);
              return (
                <MenuItem
                  key={template.legacyKey}
                  label={label}
                  disabled={hasTemplate(template.legacyKey, label)}
                  onSelect={() => addField(label)}
                />
              );
            })}
            <MenuSeparator />
            <MenuItem label={t("customField")} onSelect={() => addField("")} />
          </DropdownMenu>
        </div>
        {fields.map((field, index) => (
          <div className="profile-field" key={field.id}>
            <TextField
              fieldClassName="profile-field-key"
              className="profile-field-key-input"
              label={
                field.key ? `${t("fieldName")}: ${field.key}` : `${t("fieldName")} ${index + 1}`
              }
              labelHidden
              placeholder={t("fieldName")}
              value={field.key}
              onChange={(event) =>
                patchFields(
                  fields.map((item) =>
                    item.id === field.id ? { ...item, key: event.target.value } : item,
                  ),
                )
              }
            />
            <TextArea
              fieldClassName="profile-field-value"
              className="profile-field-value-input"
              label={`${field.key || `${t("customField")} ${index + 1}`} ${t("content")}`}
              labelHidden
              placeholder={t("content")}
              value={field.value}
              onChange={(event) =>
                patchFields(
                  fields.map((item) =>
                    item.id === field.id ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <IconButton
              className="profile-field-remove"
              tone="danger"
              label={t("removeProfileField").replace(
                "{field}",
                field.key || `${t("customField")} ${index + 1}`,
              )}
              icon={<Trash2 />}
              onClick={() => patchFields(fields.filter((item) => item.id !== field.id))}
            />
          </div>
        ))}
      </section>
    </>
  );
}
