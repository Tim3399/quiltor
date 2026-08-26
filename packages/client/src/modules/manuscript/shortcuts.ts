import { useCallback } from "react";
import { type UiLocale, useI18n } from "../../i18n";

const IS_APPLE_OS =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);

export function manuscriptShortcut(
  key: string,
  locale: UiLocale,
  modifiers: { shift?: boolean } = {},
): string {
  if (IS_APPLE_OS) return `${modifiers.shift ? "⇧" : ""}⌘${key}`;
  const parts = [locale.startsWith("de") ? "Strg" : "Ctrl"];
  if (modifiers.shift) parts.push(locale.startsWith("de") ? "Umschalt" : "Shift");
  parts.push(key);
  return parts.join("+");
}

export function useManuscriptShortcut() {
  const { locale } = useI18n();
  return useCallback(
    (key: string, modifiers?: { shift?: boolean }) => manuscriptShortcut(key, locale, modifiers),
    [locale],
  );
}
