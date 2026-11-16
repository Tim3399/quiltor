import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import {
  draftChanges,
  draftKey,
  readDraft,
  removeAllDrafts,
  removeDraft,
  writeDraft,
} from "./draftStore";
import { common } from "../../../../../locales/de/common";
import { useAutosave } from "./useAutosave";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const sessionEnded = () =>
  new ApplicationGatewayError("Bitte melde dich an, um fortzufahren.", "auth.unauthenticated", {
    category: "unauthorized",
  });

const ADA = { sub: "ada", worldId: "world-a" };
const BEN = { sub: "ben", worldId: "world-a" };

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("a save refused because the session ended (T-58 P7b)", () => {
  it("keeps the text dirty, asks to sign in and hands over the unsaved value", async () => {
    const save = vi.fn().mockRejectedValue(sessionEnded());
    const onSessionEnded = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave(value, save, undefined, { onSessionEnded }),
      { initialProps: { value: { body: "gespeichert" } }, wrapper },
    );
    const typed = { body: "neu getippt" };
    rerender({ value: typed });

    await act(async () => result.current.retry());

    expect(result.current.phase).toBe("error");
    expect(result.current.signInRequired).toBe(true);
    expect(result.current.isDirty()).toBe(true);
    expect(onSessionEnded).toHaveBeenCalledWith(typed);
  });

  it("saves on retry after signing in again and lets go of the draft", async () => {
    const save = vi.fn().mockRejectedValueOnce(sessionEnded()).mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave(value, save, undefined, { onSaved }),
      { initialProps: { value: { body: "gespeichert" } }, wrapper },
    );
    const typed = { body: "neu getippt" };
    rerender({ value: typed });
    await act(async () => result.current.retry());
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => result.current.retry());

    expect(save).toHaveBeenLastCalledWith(typed);
    expect(result.current.phase).toBe("saved");
    expect(result.current.signInRequired).toBe(false);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("does not ask to sign in for any other failure, as in local mode", async () => {
    const save = vi.fn().mockRejectedValue(new TypeError("Network connection failed"));
    const onSessionEnded = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave(value, save, undefined, { onSessionEnded }),
      { initialProps: { value: { body: "gespeichert" } }, wrapper },
    );
    rerender({ value: { body: "neu" } });
    await act(async () => result.current.retry());

    expect(result.current.phase).toBe("error");
    expect(result.current.signInRequired).toBe(false);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });
});

describe("a save refused because the account is over its world limit (F-268-18)", () => {
  // The text the HTTP boundary puts on a 403 world.quota (platform/http/request.test.ts).
  const overQuota = () =>
    new ApplicationGatewayError(common.errorWorldQuota, "world.quota", { category: "forbidden" });

  it("shows the German quota sentence and keeps the unsaved text as a draft", async () => {
    const save = vi.fn().mockRejectedValue(overQuota());
    const { result, rerender } = renderHook(
      ({ value }) =>
        useAutosave(value, save, undefined, {
          onQuotaExceeded: (unsaved) => writeDraft(ADA, "manuscript", unsaved, 3),
        }),
      { initialProps: { value: { body: "gespeichert" } }, wrapper },
    );
    const typed = { body: "neu getippt" };
    rerender({ value: typed });

    await act(async () => result.current.retry());

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe(
      "Du hast die Höchstzahl an Welten oder den Speicherplatz für deine Welten erreicht. Lösche eine Welt und leere den Papierkorb („Endgültig löschen“), dann ist wieder Platz. Eine Welt im Papierkorb zählt noch mit.",
    );
    expect(result.current.signInRequired).toBe(false);
    expect(result.current.isDirty()).toBe(true);
    expect(readDraft(ADA, "manuscript")).toMatchObject({ value: typed, baseRevision: 3 });
  });
});

describe("the draft kept on this device", () => {
  it("survives in local storage under the user, the world and the family", () => {
    expect(writeDraft(ADA, "manuscript", { chapters: [] }, 7)).toBe(true);

    const stored = localStorage.getItem(draftKey(ADA, "manuscript"));
    expect(stored).not.toBeNull();
    expect(draftKey(ADA, "manuscript")).toContain("ada");
    expect(draftKey(ADA, "manuscript")).toContain("world-a");
    expect(readDraft(ADA, "manuscript")).toMatchObject({
      family: "manuscript",
      baseRevision: 7,
      value: { chapters: [] },
    });
    expect(readDraft(ADA, "figures")).toBeNull();
    expect(readDraft({ ...ADA, worldId: "world-b" }, "manuscript")).toBeNull();
  });

  it("is never offered to another user on the same device", () => {
    writeDraft(ADA, "manuscript", { chapters: [] }, 7);
    expect(readDraft(BEN, "manuscript")).toBeNull();
  });

  it("is not kept at all without a signed-in user (local mode)", () => {
    expect(writeDraft(null, "manuscript", { chapters: [] }, 7)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("goes when it is removed, and signing out removes every world's draft of that user", () => {
    writeDraft(ADA, "manuscript", { chapters: [] }, 1);
    writeDraft({ ...ADA, worldId: "world-b" }, "figures", { nodes: [] }, 2);
    writeDraft(BEN, "manuscript", { chapters: [] }, 3);

    removeDraft(ADA, "manuscript");
    expect(readDraft(ADA, "manuscript")).toBeNull();
    expect(readDraft({ ...ADA, worldId: "world-b" }, "figures")).not.toBeNull();

    removeAllDrafts("ada");
    expect(readDraft({ ...ADA, worldId: "world-b" }, "figures")).toBeNull();
    expect(readDraft(BEN, "manuscript")).not.toBeNull();
  });

  it("leaves saving as it was when the store throws", () => {
    const preferences = quiltorClient.platform.preferences;
    vi.spyOn(preferences, "set").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(preferences, "get").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    vi.spyOn(preferences, "remove").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(writeDraft(ADA, "manuscript", { chapters: [] }, 1)).toBe(false);
    expect(readDraft(ADA, "manuscript")).toBeNull();
    expect(() => removeDraft(ADA, "manuscript")).not.toThrow();
    expect(() => removeAllDrafts("ada")).not.toThrow();
  });

  it("names the chapters a draft changes, adds or removes", () => {
    const loaded = {
      chapters: [
        { id: "c1", title: "Der Hafen", body: "alt" },
        { id: "c2", title: "Die Mole", body: "gleich" },
        { id: "c3", title: "Gestrichen", body: "weg" },
      ],
    };
    const draft = {
      chapters: [
        { id: "c1", title: "Der Hafen", body: "neu" },
        { id: "c2", title: "Die Mole", body: "gleich" },
        { id: "c4", title: "", body: "frisch" },
      ],
    };
    expect(draftChanges("manuscript", draft, loaded, "Ohne Titel")).toEqual([
      "Der Hafen",
      "Ohne Titel",
      "Gestrichen",
    ]);
  });
});
