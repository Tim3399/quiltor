import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../../modules/manuscript";
import type { ElementNoteTarget } from "../../modules/notes";
import type { FigureState } from "../../modules/story-world";
import { quiltorClient } from "../../platform";
import { App } from "../Application";
import type { LoadedWorldDocuments, WorldBinding } from "../world/useWorldSession";

// T-177: a Storyboard reference card writes the one note of its element into the element's own
// document. The surface is a stand-in that calls the same callback the Storyboard does.

vi.mock("../world/useWorldSession", () => ({
  useWorldSession: (load: (documents: LoadedWorldDocuments, binding: WorldBinding) => void) => {
    useEffect(() => {
      load(
        {
          manuscript: {
            chapters: [
              { id: "k1", title: "Eins", body: "", note: "" },
              { id: "k2", title: "Zwei", body: "", note: "" },
            ],
          },
          figures: {
            nodes: [
              { id: "mira", x: 0, y: 0, name: "Mira" },
              { id: "hafen", x: 0, y: 0, name: "Hafen", type: "ort" },
            ],
            edges: [],
            timeline: [{ id: "t1", title: "Ankunft" }],
          },
          storyboards: { boards: [], nodes: [], edges: [] },
          orphanedMentions: 0,
        },
        { worldId: "world-a", generation: 1, source: "url" },
      );
    }, [load]);
    return {
      worlds: [],
      world: { id: "world-a", title: "Welt" },
      close: vi.fn(),
      isSelected: () => true,
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

type ElementNoteChange = (
  target: ElementNoteTarget,
  text: string,
  noteReferences: [],
  noteMarks: [],
) => void;

vi.mock("./WorkspaceSurface", () => ({
  WorkspaceSurface: ({
    manuscript,
    figures,
    onElementNoteChange,
  }: {
    manuscript: Manuscript;
    figures: FigureState;
    onElementNoteChange: ElementNoteChange;
  }) => {
    const write = (target: ElementNoteTarget, text: string) =>
      onElementNoteChange(target, text, [], []);
    return (
      <>
        <output aria-label="chapter note">{manuscript.chapters[0]?.note}</output>
        <output aria-label="second chapter note">{manuscript.chapters[1]?.note}</output>
        <output aria-label="figure note">{figures.nodes[0]?.profile?.notes}</output>
        <output aria-label="place note">{figures.nodes[1]?.profile?.notes}</output>
        <output aria-label="moment note">{figures.timeline?.[0]?.note}</output>
        <button type="button" onClick={() => write({ kind: "chapter", id: "k1" }, "Kapitel")}>
          chapter
        </button>
        <button type="button" onClick={() => write({ kind: "entity", id: "mira" }, "Figur")}>
          figure
        </button>
        <button type="button" onClick={() => write({ kind: "place", id: "hafen" }, "Ort")}>
          place
        </button>
        <button type="button" onClick={() => write({ kind: "timeline", id: "t1" }, "Zeit")}>
          moment
        </button>
        <button type="button" onClick={() => write({ kind: "chapter", id: "gone" }, "Weg")}>
          deleted
        </button>
        <button
          type="button"
          onClick={() => {
            write({ kind: "chapter", id: "k1" }, "Erste");
            write({ kind: "chapter", id: "k2" }, "Zweite");
            write({ kind: "entity", id: "mira" }, "Dritte");
            write({ kind: "timeline", id: "t1" }, "Vierte");
          }}
        >
          batch
        </button>
      </>
    );
  },
}));

const saved = { ok: true as const, zeit: "2026-11-07T10:10:00Z", revision: 2 };

beforeEach(() => {
  const application = quiltorClient.application;
  for (const family of [application.manuscript, application.storyWorld, application.storyboards]) {
    vi.spyOn(family, "save").mockResolvedValue(saved);
    vi.spyOn(family, "saveExpected").mockResolvedValue(saved);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  await screen.findByRole("button", { name: "chapter" });
}

const shown = (label: string) => screen.getByLabelText(label).textContent;

describe("element notes written from a Storyboard reference card (T-177)", () => {
  it("lands a chapter's note in the manuscript", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "chapter" }));
    expect(shown("chapter note")).toBe("Kapitel");
  });

  it("lands a figure's, a place's and a moment's note in the story world", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "figure" }));
    fireEvent.click(screen.getByRole("button", { name: "place" }));
    fireEvent.click(screen.getByRole("button", { name: "moment" }));
    expect([shown("figure note"), shown("place note"), shown("moment note")]).toEqual([
      "Figur",
      "Ort",
      "Zeit",
    ]);
  });

  it("keeps every edit made in one batch", async () => {
    await renderApp();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "batch" }));
    });
    expect([
      shown("chapter note"),
      shown("second chapter note"),
      shown("figure note"),
      shown("moment note"),
    ]).toEqual(["Erste", "Zweite", "Dritte", "Vierte"]);
  });

  it("writes nothing for an element that is gone", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "deleted" }));
    expect(shown("chapter note")).toBe("");
    expect(shown("second chapter note")).toBe("");
  });
});
