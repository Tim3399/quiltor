import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDefaultStoryboardState, type StoryboardState } from "../../modules/storyboard";
import { quiltorClient } from "../../platform";
import { App } from "../Application";

const changedStoryboard: StoryboardState = {
  ...createDefaultStoryboardState(),
  nodes: [
    {
      id: "note-app-test",
      boardId: "main-storyboard",
      kind: "note",
      x: 40,
      y: 60,
      text: "Nur Planung",
    },
  ],
};

const storyboardWithBacklink: StoryboardState = {
  ...createDefaultStoryboardState(),
  nodes: [
    {
      id: "reference-ada",
      boardId: "main-storyboard",
      kind: "reference",
      target: { kind: "entity", id: "ada" },
      x: 40,
      y: 60,
    },
  ],
};

vi.mock("./WorkspaceSurface", async () => {
  const { useNoteReferenceContext } = await import("../../modules/notes");
  const { backlinksForWorldReference } = await import("../../modules/world-references");
  return {
    WorkspaceSurface: ({
      workspace,
      storyboardHistory,
    }: {
      workspace: string;
      storyboardHistory: { change: (value: StoryboardState) => void };
    }) => {
      const references = useNoteReferenceContext();
      const adaBacklinks = backlinksForWorldReference(references.backlinks, {
        kind: "entity",
        id: "ada",
      });
      return (
        <section aria-label={`Test-Arbeitsbereich ${workspace}`}>
          <span data-testid="ada-backlinks">{adaBacklinks.length}</span>
          {workspace === "storyboard" && (
            <button type="button" onClick={() => storyboardHistory.change(changedStoryboard)}>
              Storyboard-Teständerung
            </button>
          )}
        </section>
      );
    },
  };
});

vi.mock("../overlays/OverlayHost", () => ({ OverlayHost: () => null }));

const world = {
  id: "storyboard-app-world",
  title: "Planungswelt",
  backupUrl: "",
  updated: "2026-08-30T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("Application Storyboard integration", () => {
  it("shows the fifth workspace and flushes its independent save lane", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    history.replaceState(null, "", `/?world=${world.id}`);
    vi.spyOn(quiltorClient.application.worlds, "select").mockImplementation(() => undefined);
    vi.spyOn(quiltorClient.application.worlds, "list").mockResolvedValue({
      ok: true,
      worlds: [world],
    });
    vi.spyOn(quiltorClient.application.worlds, "open").mockResolvedValue({ ok: true, world });
    vi.spyOn(quiltorClient.application.manuscript, "load").mockResolvedValue({ chapters: [] });
    vi.spyOn(quiltorClient.application.storyWorld, "load").mockResolvedValue({
      nodes: [{ id: "ada", name: "Ada", type: "person", x: 0, y: 0 }],
      edges: [],
    });
    vi.spyOn(quiltorClient.application.storyboards, "load").mockResolvedValue(
      storyboardWithBacklink,
    );
    const saveStoryboards = vi
      .spyOn(quiltorClient.application.storyboards, "save")
      .mockResolvedValue({ ok: true, zeit: "2026-08-30T12:01:00.000Z", revision: 1 });
    const saveManuscript = vi
      .spyOn(quiltorClient.application.manuscript, "save")
      .mockResolvedValue({ ok: true, zeit: "", revision: 1 });
    const saveStoryWorld = vi
      .spyOn(quiltorClient.application.storyWorld, "save")
      .mockResolvedValue({ ok: true, zeit: "", revision: 1 });
    vi.spyOn(quiltorClient.application.identity, "current").mockResolvedValue({
      ok: true,
      multiUser: false,
    });
    vi.spyOn(quiltorClient.application.metadata, "version").mockResolvedValue({
      ok: true,
      version: "test",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const storyboardTab = await screen.findByRole("button", { name: "Storyboard" });
    expect(screen.getByTestId("ada-backlinks")).toHaveTextContent("1");
    fireEvent.click(storyboardTab);
    expect(storyboardTab).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Storyboard-Teständerung" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ungespeichert"));

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(saveStoryboards).toHaveBeenCalledWith(changedStoryboard));
    expect(saveManuscript).not.toHaveBeenCalled();
    expect(saveStoryWorld).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Gespeichert"));
  });
});
