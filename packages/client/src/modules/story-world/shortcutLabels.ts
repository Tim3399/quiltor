import type { UiLocale } from "../../i18n";

const isApplePlatform =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);

export function storyShortcutLabel(
  key: string,
  locale: UiLocale,
  modifiers: { shift?: boolean } = {},
): string {
  if (isApplePlatform) return `${modifiers.shift ? "⇧" : ""}⌘${key}`;
  const parts = [locale.startsWith("de") ? "Strg" : "Ctrl"];
  if (modifiers.shift) parts.push(locale.startsWith("de") ? "Umschalt" : "Shift");
  parts.push(key);
  return parts.join("+");
}
