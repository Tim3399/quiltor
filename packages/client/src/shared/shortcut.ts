// The type only, no runtime import: otherwise every user of shared would drag the complete
// language catalogues along -- and with them their JSON manifests, which break Playwright's
// ESM loader. The React hook for it lives in app/shell, where the binding to i18n belongs.
import type { UiLocale } from "../i18n";

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

/** A shortcut as people read it and as aria-keyshortcuts names it ("Control+Z", "Meta+Z"). */
type KeyShortcut = { label: string; keys: string };

/**
 * Undo and redo as every workspace binds them: the platform modifier with Z, plus shift to redo
 * (app/shortcuts/useApplicationShortcuts.ts). One definition, so the five toolbars cannot drift.
 */
export function historyShortcuts(locale: UiLocale): { undo: KeyShortcut; redo: KeyShortcut } {
  const modifier = IS_APPLE_OS ? "Meta" : "Control";
  return {
    undo: { label: shortcut("Z", locale), keys: `${modifier}+Z` },
    redo: { label: shortcut("Z", locale, { shift: true }), keys: `${modifier}+Shift+Z` },
  };
}
