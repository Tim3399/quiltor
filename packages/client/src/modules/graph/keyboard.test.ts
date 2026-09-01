import { describe, expect, it } from "vitest";
import {
  isGraphDeleteShortcut,
  isGraphEditingTarget,
  isGraphShortcutBlockedTarget,
} from "./keyboard";

function deleteEvent(target: EventTarget, overrides: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Delete",
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
  target.dispatchEvent(event);
  return event;
}

describe("graph keyboard shortcuts", () => {
  it("recognizes unmodified Delete and Backspace outside editors", () => {
    expect(isGraphDeleteShortcut(deleteEvent(document.body))).toBe(true);
    expect(isGraphDeleteShortcut(deleteEvent(document.body, { key: "Backspace" }))).toBe(true);
    expect(isGraphDeleteShortcut(deleteEvent(document.body, { key: "Enter" }))).toBe(false);
    expect(isGraphDeleteShortcut(deleteEvent(document.body, { ctrlKey: true }))).toBe(false);
    expect(isGraphDeleteShortcut(deleteEvent(document.body, { shiftKey: true }))).toBe(false);
  });

  it("protects native, ARIA, and contenteditable form inputs", () => {
    const input = document.createElement("input");
    const select = document.createElement("select");
    const editor = document.createElement("div");
    const editorChild = document.createElement("span");
    editor.setAttribute("contenteditable", "true");
    editor.append(editorChild);
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");

    for (const target of [input, select, editorChild, textbox]) {
      document.body.append(target === editorChild ? editor : target);
      expect(isGraphEditingTarget(target)).toBe(true);
      expect(isGraphDeleteShortcut(deleteEvent(target))).toBe(false);
      target === editorChild ? editor.remove() : target.remove();
    }
  });

  it.each([
    ["dialog", "dialog"],
    ["alert dialog", "alertdialog"],
    ["menu", "menu"],
  ])("blocks shortcuts inside a %s", (_, role) => {
    const overlay = document.createElement("div");
    const action = document.createElement("button");
    overlay.setAttribute("role", role);
    overlay.append(action);
    document.body.append(overlay);

    expect(isGraphShortcutBlockedTarget(action)).toBe(true);
    expect(isGraphDeleteShortcut(deleteEvent(action))).toBe(false);
    overlay.remove();
  });

  it("blocks explicit nokey and aria-modal shortcut scopes", () => {
    for (const attribute of ["class", "aria-modal"] as const) {
      const scope = document.createElement("div");
      const action = document.createElement("button");
      if (attribute === "class") scope.className = "nokey";
      else scope.setAttribute(attribute, "true");
      scope.append(action);
      document.body.append(scope);

      expect(isGraphDeleteShortcut(deleteEvent(action))).toBe(false);
      scope.remove();
    }
  });
});
