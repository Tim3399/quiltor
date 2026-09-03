import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, SegmentedControl, SidePanelHeader } from "../../design";
import { useI18n } from "../../i18n";
import "./ManuscriptInspector.css";

export type ManuscriptInspectorRegister = "chapter" | "writingAid";

export interface ManuscriptInspectorProps {
  title: string;
  register: ManuscriptInspectorRegister;
  onRegisterChange: (register: ManuscriptInspectorRegister) => void;
  onClose: () => void;
  chapter: ReactNode;
  writingAid: ReactNode;
}

/**
 * The right-hand column: everything that acts on what the binder has selected.
 *
 * Two registers, never more -- the chapter itself and the writing aid. They share one
 * header and one close control so the column reads as a single place, which is the point
 * of moving the note and the story time here off the binder.
 */
export function ManuscriptInspector({
  title,
  register,
  onRegisterChange,
  onClose,
  chapter,
  writingAid,
}: ManuscriptInspectorProps) {
  const { t } = useI18n();

  return (
    <>
      <SidePanelHeader
        className="manuscript-inspector__header"
        title={title}
        actions={
          <IconButton
            label={t("closeInspector")}
            icon={<X />}
            onClick={onClose}
            title={t("closeInspector")}
          />
        }
      />
      <div className="manuscript-inspector__registers">
        <SegmentedControl
          label={t("inspectorRegister")}
          size="compact"
          value={register}
          onChange={onRegisterChange}
          options={[
            { value: "chapter", label: t("chapter") },
            { value: "writingAid", label: t("writingAid") },
          ]}
        />
      </div>
      {register === "chapter" ? chapter : writingAid}
    </>
  );
}
