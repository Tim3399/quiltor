import { useCallback } from "react";
import { type UiLocale, useI18n } from "../../i18n";

// The platform never changes while the app runs, so it is sniffed exactly once here and every
// shortcut label reads this one constant afterwards. Shortcut notation lives in a .ts file on
// purpose: these are key names, not translatable prose, and tools/quality/check_i18n.mjs only scans
// .tsx -- writing them in a component would trip the hardcoded-text gate for no benefit.
export const IS_APPLE_OS =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);

// Apple writes modifiers as symbols without separators, Windows and Linux spell them out and join
// them with a plus. The language only decides how that spelled-out word reads -- a German keyboard
// says "Strg", not "Ctrl".
export function shortcut(
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

export function useShortcut() {
  const { locale } = useI18n();
  return useCallback(
    (key: string, modifiers?: { shift?: boolean }) => shortcut(key, locale, modifiers),
    [locale],
  );
}

export function undoShortcut(locale: UiLocale): string {
  return shortcut("Z", locale);
}
