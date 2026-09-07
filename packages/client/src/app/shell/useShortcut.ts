import { useCallback } from "react";
import { useI18n } from "../../i18n";
import { shortcut } from "../../shared";

/** How a keyboard shortcut is spelled in the language of the interface. */
export function useShortcut() {
  const { locale } = useI18n();
  return useCallback(
    (key: string, modifiers?: { shift?: boolean }) => shortcut(key, locale, modifiers),
    [locale],
  );
}
