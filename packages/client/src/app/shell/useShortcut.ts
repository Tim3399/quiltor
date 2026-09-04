import { useCallback } from "react";
import { useI18n } from "../../i18n";
import { shortcut } from "../../shared";

/** Die Schreibweise einer Tastenkombination in der Sprache der Oberflaeche. */
export function useShortcut() {
  const { locale } = useI18n();
  return useCallback(
    (key: string, modifiers?: { shift?: boolean }) => shortcut(key, locale, modifiers),
    [locale],
  );
}
