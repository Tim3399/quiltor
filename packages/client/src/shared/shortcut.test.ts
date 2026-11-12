import { describe, expect, it } from "vitest";
import { historyShortcuts, IS_APPLE_OS, shortcut } from "./shortcut";

// IS_APPLE_OS is read once at module load, so the branch that runs here is the one this machine
// would show. Both branches are asserted through the constant rather than by stubbing navigator,
// which would no longer be read after the module has been evaluated.
describe("shortcut notation", () => {
  it("writes Apple modifiers as symbols and everyone else spelled out", () => {
    expect(shortcut("K", "de")).toBe(IS_APPLE_OS ? "⌘K" : "Strg+K");
    expect(shortcut("K", "en")).toBe(IS_APPLE_OS ? "⌘K" : "Ctrl+K");
  });

  it("adds the shift modifier in the notation the platform uses", () => {
    expect(shortcut("Z", "de", { shift: true })).toBe(IS_APPLE_OS ? "⇧⌘Z" : "Strg+Umschalt+Z");
    expect(shortcut("Z", "en", { shift: true })).toBe(IS_APPLE_OS ? "⇧⌘Z" : "Ctrl+Shift+Z");
  });
});

describe("history shortcuts", () => {
  it("names undo and redo as the application binds them", () => {
    const modifier = IS_APPLE_OS ? "Meta" : "Control";
    expect(historyShortcuts("de")).toEqual({
      undo: { label: IS_APPLE_OS ? "⌘Z" : "Strg+Z", keys: `${modifier}+Z` },
      redo: { label: IS_APPLE_OS ? "⇧⌘Z" : "Strg+Umschalt+Z", keys: `${modifier}+Shift+Z` },
    });
  });
});
