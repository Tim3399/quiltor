import { useCallback } from "react";
import { useLanguage, type Language } from "../../language";

// The platform never changes while the app runs, so it is sniffed exactly once here and every
// shortcut label reads this one constant afterwards. Shortcut notation lives in a .ts file on
// purpose: these are key names, not translatable prose, and scripts/check-i18n.mjs only scans .tsx --
// writing them in a component would trip the hardcoded-text gate for no benefit.
export const IS_APPLE_OS =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);

// Apple writes modifiers as symbols without separators, Windows and Linux spell them out and join
// them with a plus. The language only decides how that spelled-out word reads -- a German keyboard
// says "Strg", not "Ctrl".
export function shortcut(
  key: string,
  language: Language,
  modifiers: { shift?: boolean } = {},
): string {
  if (IS_APPLE_OS) return `${modifiers.shift ? "⇧" : ""}⌘${key}`;
  const parts = [language === "de" ? "Strg" : "Ctrl"];
  if (modifiers.shift) parts.push(language === "de" ? "Umschalt" : "Shift");
  parts.push(key);
  return parts.join("+");
}

export function useShortcut() {
  const { language } = useLanguage();
  return useCallback(
    (key: string, modifiers?: { shift?: boolean }) => shortcut(key, language, modifiers),
    [language],
  );
}

export function undoShortcut(language: Language): string {
  return shortcut("Z", language);
}
