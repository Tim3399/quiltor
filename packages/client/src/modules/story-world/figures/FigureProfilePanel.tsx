import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, TextArea, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode, Profile } from "../model";
import { PROFILE_FIELDS } from "./profileFields";

export function FigureProfilePanel({
  figure,
  onPatch,
}: {
  figure: FigureNode;
  onPatch: (patch: Partial<FigureNode>) => void;
}) {
  const { t } = useI18n();
  const profile = figure.profile || { extra: [] };
  const patchProfile = (patch: Partial<Profile>) => onPatch({ profile: { ...profile, ...patch } });

  return (
    <>
      {PROFILE_FIELDS.map(([key, label, size]) =>
        size === "short" ? (
          <TextField
            fieldClassName="figure-profile-field"
            key={key as string}
            fieldId={`figure-profile-${figure.id}-${String(key)}`}
            label={t(label)}
            value={String(profile[key] || "")}
            onChange={(event) => patchProfile({ [key]: event.target.value })}
          />
        ) : (
          <TextArea
            fieldClassName="figure-profile-field"
            key={key as string}
            fieldId={`figure-profile-${figure.id}-${String(key)}`}
            label={t(label)}
            value={String(profile[key] || "")}
            onChange={(event) => patchProfile({ [key]: event.target.value })}
          />
        ),
      )}
      <h3 className="section-label">{t("customFields")}</h3>
      {(profile.extra || []).map((field, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Profile extras have no persistent id and their stored order is their identity.
        <div className="custom-field" key={index}>
          <TextField
            fieldClassName="custom-field-key"
            className="custom-field-key-input"
            label={t("fieldName")}
            labelHidden
            placeholder={t("fieldName")}
            value={field.k}
            onChange={(event) =>
              patchProfile({
                extra: (profile.extra || []).map((item, position) =>
                  position === index ? { ...item, k: event.target.value } : item,
                ),
              })
            }
          />
          <TextArea
            fieldClassName="custom-field-value"
            className="custom-field-value-input"
            label={`${field.k || t("customField")} ${t("content")}`}
            labelHidden
            placeholder={t("content")}
            value={field.v}
            onChange={(event) =>
              patchProfile({
                extra: (profile.extra || []).map((item, position) =>
                  position === index ? { ...item, v: event.target.value } : item,
                ),
              })
            }
          />
          <IconButton
            className="custom-field-remove"
            tone="danger"
            label={t("removeCustomField")}
            icon={<Trash2 />}
            onClick={() =>
              patchProfile({
                extra: (profile.extra || []).filter((_, position) => position !== index),
              })
            }
          />
        </div>
      ))}
      <Button
        className="figure-custom-field-add"
        icon={<Plus />}
        onClick={() => patchProfile({ extra: [...(profile.extra || []), { k: "", v: "" }] })}
      >
        {t("customField")}
      </Button>
    </>
  );
}
