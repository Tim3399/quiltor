import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../../modules/manuscript";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import { App } from "../Application";
import type { LoadedWorldDocuments, WorldBinding } from "../world/useWorldSession";
import { readDraft, writeDraft } from "./draftStore";
import type { useHistoryState } from "./useHistoryState";

// T-58 P7b: the session ends while the author types. Nothing typed may be lost.

const shell = vi.hoisted(() => ({
  account: { sub: "ada", email: "ada@example.org" } as { sub?: string; email?: string } | null,
  logout: () => undefined,
}));

vi.mock("../world/useWorldSession", () => ({
  useWorldSession: (load: (documents: LoadedWorldDocuments, binding: WorldBinding) => void) => {
    useEffect(() => {
      load(documents("Anfang"), { worldId: "world-a", generation: 1, source: "url" });
    }, [load]);
    return {
      worlds: [],
      world: { id: "world-a", title: "Welt" },
      close: vi.fn(),
      isSelected: (binding: WorldBinding) => binding.worldId === "world-a",
    };
  },
}));
vi.mock("../shell/useShellStatus", () => ({
  useShellStatus: () => ({ account: shell.account, logout: shell.logout }),
}));
vi.mock("../shell/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    preference: "light",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));
vi.mock("./WorkspaceSurface", () => ({
  WorkspaceSurface: ({
    manuscript,
    manuscriptHistory,
    documentsReady,
  }: {
    manuscript: Manuscript;
    manuscriptHistory: ReturnType<typeof useHistoryState<Manuscript>>;
    documentsReady: boolean;
  }) =>
    documentsReady ? (
      <button
        type="button"
        onClick={() =>
          manuscriptHistory.change({
            ...manuscript,
            chapters: [{ ...manuscript.chapters[0], body: `${manuscript.chapters[0].body}+` }],
          })
        }
      >
        {manuscript.chapters[0].body}
      </button>
    ) : (
      <p role="status">Kapitel lädt …</p>
    ),
}));

function documents(body: string): LoadedWorldDocuments {
  return {
    manuscript: { chapters: [{ id: "chapter-1", title: "Eins", body, note: "" }] },
    figures: { nodes: [], edges: [] },
    storyboards: { boards: [], nodes: [], edges: [] },
    orphanedMentions: 0,
  };
}

const ADA = { sub: "ada", worldId: "world-a" };
const DRAFT = { chapters: [{ id: "chapter-1", title: "Eins", body: "Entwurf", note: "" }] };
const saved = { ok: true as const, zeit: "2026-11-07T10:00:00Z", revision: 9 };
const ended = () =>
  new ApplicationGatewayError("Bitte melde dich an, um fortzufahren.", "auth.unauthenticated", {
    category: "unauthorized",
  });

function renderApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  shell.account = { sub: "ada", email: "ada@example.org" };
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const application = quiltorClient.application;
  vi.spyOn(application.storyWorld, "save").mockResolvedValue(saved);
  vi.spyOn(application.storyboards, "save").mockResolvedValue(saved);
  vi.spyOn(application.manuscript, "revision").mockReturnValue(4);
  vi.spyOn(application.manuscript, "peek").mockResolvedValue({
    document: documents("Serverstand").manuscript,
    revision: 5,
  });
  vi.spyOn(application.storyWorld, "peek").mockResolvedValue({
    document: { nodes: [], edges: [] },
    revision: 1,
  });
  vi.spyOn(application.storyboards, "peek").mockResolvedValue({
    document: { boards: [], nodes: [], edges: [] },
    revision: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("typing after the session ended", () => {
  it("asks to sign in in a new tab, keeps a draft and saves it on retry", async () => {
    const save = vi
      .spyOn(quiltorClient.application.manuscript, "save")
      .mockRejectedValueOnce(ended())
      .mockResolvedValue(saved);
    const open = vi
      .spyOn(quiltorClient.platform.externalNavigation, "open")
      .mockImplementation(() => undefined);
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Anfang" }));
    expect(
      await screen.findByText(
        "Deine Anmeldung ist abgelaufen. Melde dich in einem neuen Tab an, dein Text bleibt hier erhalten.",
        {},
        { timeout: 3000 },
      ),
    ).toBeVisible();
    // The workspace stays: no sign-in gate takes the text away.
    expect(screen.getByRole("button", { name: "Anfang+" })).toBeVisible();
    expect(readDraft(ADA, "manuscript")).toMatchObject({
      baseRevision: 4,
      value: { chapters: [{ body: "Anfang+" }] },
    });

    fireEvent.click(screen.getByRole("button", { name: "In neuem Tab anmelden" }));
    expect(open).toHaveBeenCalledWith("/login");

    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(readDraft(ADA, "manuscript")).toBeNull());
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ chapters: [expect.objectContaining({ body: "Anfang+" })] }),
    );
  });
});

describe("a draft kept from an earlier visit", () => {
  it("is offered and adopted against the revision it was written on", async () => {
    writeDraft(ADA, "manuscript", DRAFT, 4);
    const saveExpected = vi
      .spyOn(quiltorClient.application.manuscript, "saveExpected")
      .mockResolvedValue(saved);
    renderApp();

    expect(
      await screen.findByRole("heading", { name: "Ungespeicherter Entwurf gefunden: Manuskript" }),
    ).toBeVisible();
    expect(screen.getByText(/Betroffen: Eins\./)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Entwurf übernehmen" }));

    expect(await screen.findByRole("button", { name: "Entwurf" })).toBeVisible();
    expect(saveExpected).toHaveBeenCalledWith(DRAFT, 4);
    expect(readDraft(ADA, "manuscript")).toBeNull();
  });

  it("opens the conflict dialog when the server moved on, never overwriting it", async () => {
    writeDraft(ADA, "manuscript", DRAFT, 4);
    vi.spyOn(quiltorClient.application.manuscript, "saveExpected").mockRejectedValue(
      new ApplicationGatewayError("Revision geändert", "document.revision_conflict", {
        category: "conflict",
      }),
    );
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Entwurf übernehmen" }));

    expect(await screen.findByRole("heading", { name: "Konflikt vergleichen" })).toBeVisible();
    // Still there until the author decides in the conflict dialog.
    expect(readDraft(ADA, "manuscript")).not.toBeNull();
  });

  it("is gone after discarding it", async () => {
    writeDraft(ADA, "manuscript", DRAFT, 4);
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Entwurf verwerfen" }));

    await waitFor(() => expect(readDraft(ADA, "manuscript")).toBeNull());
    expect(screen.queryByRole("heading", { name: /Ungespeicherter Entwurf/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Anfang" })).toBeVisible();
  });

  it("is not offered to another user signed in on this device", async () => {
    writeDraft(ADA, "manuscript", DRAFT, 4);
    shell.account = { sub: "ben", email: "ben@example.org" };
    renderApp();

    expect(await screen.findByRole("button", { name: "Anfang" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Ungespeicherter Entwurf/ })).toBeNull();
  });

  it("is removed when the author signs out", async () => {
    writeDraft(ADA, "manuscript", DRAFT, 4);
    writeDraft({ ...ADA, worldId: "world-b" }, "figures", { nodes: [], edges: [] }, 2);
    const logout = vi.fn();
    shell.logout = logout;
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Entwurf verwerfen" }));

    fireEvent.click(await screen.findByRole("button", { name: /Mehr|Menü|Weitere/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Abmelden" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(readDraft({ ...ADA, worldId: "world-b" }, "figures")).toBeNull();
  });
});

describe("local mode", () => {
  it("keeps no draft and offers nothing without a signed-in user", async () => {
    shell.account = null;
    vi.spyOn(quiltorClient.application.manuscript, "save").mockRejectedValue(ended());
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Anfang" }));
    await act(() => new Promise<void>((done) => setTimeout(done, 1200)));

    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys.filter((key) => key?.startsWith("quiltor.draft"))).toEqual([]);
    expect(screen.queryByRole("heading", { name: /Ungespeicherter Entwurf/ })).toBeNull();
  });
});
