import type { Translate } from "../../i18n";
import type { NoteFocusCopy } from "./model";

export function noteFocusCopy(t: Translate, context: string): NoteFocusCopy {
  return {
    openLabel: t("noteFocusOpen"),
    title: t("noteFocusTitle", { context }),
    closeLabel: t("noteFocusClose", { context }),
    editorLabel: t("noteFocusEditor", { context }),
  };
}
