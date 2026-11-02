import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { FigureState } from "../../modules/story-world";
import type { Manuscript } from "../../modules/manuscript";
import type { StoryboardState } from "../../modules/storyboard";
import { quiltorClient } from "../../platform";
import { App } from "../Application";
import type { LoadedWorldDocuments, WorldBinding } from "../world/useWorldSession";
import type { useHistoryState } from "./useHistoryState";

// A world session that the test can make load again, with a selection that really moves.
const session = vi.hoisted(() => ({
  load: null as null | ((documents: LoadedWorldDocuments, binding: WorldBinding) => void),
  selected: { worldId: "world-a", generation: 1 },
}));

vi.mock("../world/useWorldSession", () => ({
  useWorldSession: (load: (documents: LoadedWorldDocuments, binding: WorldBinding) => void) => {
    session.load = load;
    useEffect(() => {
      load(documents("Anfang"), { worldId: "world-a", generation: 1, source: "url" });
    }, [load]);
    return {
      worlds: [],
      world: { id: session.selected.worldId, title: "Welt" },
      close: vi.fn(),
      isSelected: (binding: WorldBinding) =>
        binding.worldId === session.selected.worldId &&
        binding.generation === session.selected.generation,
    };
  },
}));
vi.mock("../shell/useShellStatus", () => ({
  useShellStatus: () => ({ account: { email: "author@example.org" }, logout: vi.fn() }),
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
    figures,
    figureHistory,
    storyboards,
    storyboardHistory,
    documentsReady,
  }: {
    manuscript: Manuscript;
    manuscriptHistory: ReturnType<typeof useHistoryState<Manuscript>>;
    figures: FigureState;
    figureHistory: ReturnType<typeof useHistoryState<FigureState>>;
    storyboards: StoryboardState;
    storyboardHistory: ReturnType<typeof useHistoryState<StoryboardState>>;
    documentsReady: boolean;
  }) => (
    <>
      <output aria-label="figure count">{figures.nodes.length}</output>
      <output aria-label="storyboard count">{storyboards.boards.length}</output>
      <button
        type="button"
        onClick={() =>
          figureHistory.change({
            ...figures,
            nodes: [
              ...figures.nodes,
              { id: `figure-${figures.nodes.length}`, name: "Ada" } as never,
            ],
          })
        }
      >
        add figure
      </button>
      <button
        type="button"
        onClick={() =>
          storyboardHistory.change({
            ...storyboards,
            boards: [
              ...storyboards.boards,
              { id: `board-${storyboards.boards.length}`, title: "Akt" } as never,
            ],
          })
        }
      >
        add board
      </button>
      {documentsReady ? (
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
      )}
    </>
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

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));
const refused = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.some((call) => String(call[0]).startsWith("[quiltor] save refused"));
const loadOverUnsaved = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.filter((call) => String(call[0]) === "[quiltor] load over unsaved changes");

let warn: { mock: { calls: unknown[][] } };
let save: { mock: { calls: { chapters: { body: string }[] }[][] } };
let saveExpected: { mock: { calls: [{ chapters: { body: string }[] }, number][] } };
const saved = { ok: true as const, zeit: "2026-10-31T10:10:00Z", revision: 9 };

beforeEach(() => {
  session.selected = { worldId: "world-a", generation: 1 };
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const application = quiltorClient.application;
  save = vi.spyOn(application.manuscript, "save").mockResolvedValue(saved);
  saveExpected = vi.spyOn(application.manuscript, "saveExpected").mockResolvedValue(saved);
  vi.spyOn(application.storyWorld, "save").mockResolvedValue(saved);
  vi.spyOn(application.storyboards, "save").mockResolvedValue(saved);
  vi.spyOn(application.manuscript, "peek").mockResolvedValue({
    document: documents("Serverstand").manuscript,
    revision: 8,
  });
  vi.spyOn(application.storyWorld, "peek").mockResolvedValue({
    document: { nodes: [], edges: [] },
    revision: 1,
  });
  vi.spyOn(application.storyboards, "peek").mockResolvedValue({
    document: { boards: [], nodes: [], edges: [] },
    revision: 1,
  });
  vi.spyOn(application.manuscript, "adoptPersisted").mockImplementation(
    (versioned) => versioned.document,
  );
  vi.spyOn(quiltorClient.platform.files, "save").mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function editThenLoadAgain() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Anfang" }));
  expect(screen.getByRole("button", { name: "Anfang+" })).toBeVisible();
  // The same world loads again with a new generation before the draft is saved.
  session.selected = { worldId: "world-a", generation: 2 };
  act(() => session.load?.(documents("Serverstand"), { ...session.selected, source: "open" }));
}

async function authorizeDecision() {
  fireEvent.click(await screen.findByRole("button", { name: "Gespeicherte Fassung laden" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Beide Fassungen als JSON herunterladen" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Gespeicherte Fassung übernehmen" })).toBeEnabled(),
  );
}

describe("a load over unsaved manuscript changes (rule 2)", () => {
  it("opens the conflict dialog instead of replacing, then saves the adopted version (b-1)", async () => {
    await editThenLoadAgain();
    expect(await screen.findByRole("heading", { name: "Konflikt vergleichen" })).toBeVisible();
    expect(screen.getByText("Kapitel lädt …")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Serverstand" })).not.toBeInTheDocument();
    expect(loadOverUnsaved(warn)).toHaveLength(1);
    await wait(1000);
    expect(save).not.toHaveBeenCalled();

    await authorizeDecision();
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung übernehmen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Serverstand" }));
    await wait(1000);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].chapters[0].body).toBe("Serverstand+");
    expect(refused(warn)).toBe(false);
  });

  it("keeps the draft against the arrived revision when the author chooses it (b-2)", async () => {
    await editThenLoadAgain();
    await authorizeDecision();
    fireEvent.click(
      screen.getByRole("button", { name: "Meinen Entwurf als neue Fassung speichern" }),
    );
    await waitFor(() => expect(saveExpected).toHaveBeenCalledOnce());
    expect(saveExpected.mock.calls[0][0].chapters[0].body).toBe("Anfang+");
    expect(saveExpected.mock.calls[0][1]).toBe(8);
    expect(await screen.findByRole("button", { name: "Anfang+" })).toBeVisible();
    expect(refused(warn)).toBe(false);
  });

  it("loads another world's documents without asking, even over unsaved changes (b″)", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Anfang" }));
    session.selected = { worldId: "world-b", generation: 2 };
    act(() => session.load?.(documents("Anfang in B"), { ...session.selected, source: "open" }));
    expect(await screen.findByRole("button", { name: "Anfang in B" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Konflikt vergleichen" })).not.toBeInTheDocument();
    expect(loadOverUnsaved(warn)).toHaveLength(0);
  });
});

describe("a load over unsaved figure or storyboard changes (rule 2, T-73)", () => {
  let storyWorldSave: { mock: { calls: unknown[][] } };
  let storyWorldSaveExpected: { mock: { calls: [FigureState, number][] } };
  let storyboardsSave: { mock: { calls: unknown[][] } };
  let storyboardsSaveExpected: { mock: { calls: [StoryboardState, number][] } };

  beforeEach(() => {
    const application = quiltorClient.application;
    storyWorldSave = vi.spyOn(application.storyWorld, "save").mockResolvedValue(saved);
    storyWorldSaveExpected = vi
      .spyOn(application.storyWorld, "saveExpected")
      .mockResolvedValue(saved);
    storyboardsSave = vi.spyOn(application.storyboards, "save").mockResolvedValue(saved);
    storyboardsSaveExpected = vi
      .spyOn(application.storyboards, "saveExpected")
      .mockResolvedValue(saved);
    vi.spyOn(application.storyWorld, "peek").mockResolvedValue({
      document: { nodes: [], edges: [] },
      revision: 5,
    });
    vi.spyOn(application.storyboards, "peek").mockResolvedValue({
      document: { boards: [], nodes: [], edges: [] },
      revision: 6,
    });
    vi.spyOn(application.storyWorld, "adoptPersisted").mockImplementation(
      (versioned) => versioned.document,
    );
    vi.spyOn(application.storyboards, "adoptPersisted").mockImplementation(
      (versioned) => versioned.document,
    );
  });

  async function editThen(button: string) {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: "Anfang" });
    fireEvent.click(screen.getByRole("button", { name: button }));
    session.selected = { worldId: "world-a", generation: 2 };
    act(() => session.load?.(documents("Serverstand"), { ...session.selected, source: "open" }));
  }

  it("holds back a load over unsaved figures and keeps the draft against the arrived revision", async () => {
    await editThen("add figure");
    expect(await screen.findByRole("heading", { name: "Konflikt vergleichen" })).toBeVisible();
    expect(screen.getByRole("status", { name: "figure count" })).toHaveTextContent("1");
    expect(loadOverUnsaved(warn)).toHaveLength(1);
    await wait(1000);
    expect(storyWorldSave.mock.calls).toHaveLength(0);

    await authorizeDecision();
    fireEvent.click(
      screen.getByRole("button", { name: "Meinen Entwurf als neue Fassung speichern" }),
    );
    await waitFor(() => expect(storyWorldSaveExpected.mock.calls).toHaveLength(1));
    expect(storyWorldSaveExpected.mock.calls[0][0].nodes).toHaveLength(1);
    expect(storyWorldSaveExpected.mock.calls[0][1]).toBe(5);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Konflikt vergleichen" }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("button", { name: "Serverstand" })).toBeVisible();
    expect(refused(warn)).toBe(false);
  });

  it("holds back a load over unsaved storyboards and adopts the arrived version on request", async () => {
    await editThen("add board");
    expect(await screen.findByRole("heading", { name: "Konflikt vergleichen" })).toBeVisible();
    expect(screen.getByRole("status", { name: "storyboard count" })).toHaveTextContent("1");
    await wait(1000);
    expect(storyboardsSave.mock.calls).toHaveLength(0);

    await authorizeDecision();
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung übernehmen" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "storyboard count" })).toHaveTextContent("0"),
    );
    fireEvent.click(screen.getByRole("button", { name: "add board" }));
    await wait(1000);
    expect(storyboardsSave.mock.calls).toHaveLength(1);
    expect(storyboardsSaveExpected.mock.calls).toHaveLength(0);
    expect(refused(warn)).toBe(false);
  });

  it("asks once per family when manuscript and figures are both unsaved", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Anfang" }));
    fireEvent.click(screen.getByRole("button", { name: "add figure" }));
    session.selected = { worldId: "world-a", generation: 2 };
    act(() => session.load?.(documents("Serverstand"), { ...session.selected, source: "open" }));

    await authorizeDecision();
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung übernehmen" }));
    // The figures still wait for their own decision, in a fresh dialog.
    expect(await screen.findByRole("button", { name: "Gespeicherte Fassung laden" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Konflikt vergleichen" })).toBeVisible();
    expect(screen.getByRole("status", { name: "figure count" })).toHaveTextContent("1");
    await authorizeDecision();
    fireEvent.click(
      screen.getByRole("button", { name: "Meinen Entwurf als neue Fassung speichern" }),
    );
    await waitFor(() => expect(storyWorldSaveExpected.mock.calls).toHaveLength(1));
    expect(storyWorldSaveExpected.mock.calls[0][1]).toBe(5);
    expect(await screen.findByRole("button", { name: "Serverstand" })).toBeVisible();
    expect(refused(warn)).toBe(false);
  });
});
