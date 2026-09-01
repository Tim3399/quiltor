const GRAPH_EDITING_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
].join(", ");

const GRAPH_SHORTCUT_BLOCKER_SELECTOR = [
  ".nokey",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[aria-modal="true"]',
].join(", ");

export function isGraphEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(GRAPH_EDITING_TARGET_SELECTOR));
}

export function isGraphShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(GRAPH_SHORTCUT_BLOCKER_SELECTOR));
}

export function isGraphDeleteShortcut(event: KeyboardEvent): boolean {
  const activeElement = typeof document === "undefined" ? null : document.activeElement;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    isGraphEditingTarget(event.target) ||
    isGraphEditingTarget(activeElement) ||
    isGraphShortcutBlockedTarget(event.target) ||
    isGraphShortcutBlockedTarget(activeElement)
  ) {
    return false;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.key === "Backspace" || event.key === "Delete";
}
