import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../../modules/manuscript";
import { quiltorClient } from "../../platform";
import { App } from "../Application";
import type { useHistoryState } from "./useHistoryState";

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
  }: {
    manuscript: Manuscript;
    manuscriptHistory: ReturnType<typeof useHistoryState<Manuscript>>;
  }) => (
    <button
      type="button"
      onClick={() =>
        manuscriptHistory.change({
          ...manuscript,
          chapters: manuscript.chapters.map((chapter, index) =>
            index === 0 ? { ...chapter, body: "Entwurf in A" } : chapter,
          ),
        })
      }
    >
      {manuscript.chapters[0]?.body}
    </button>
  ),
}));

const worldA = { id: "world-a", title: "Welt A", backupUrl: "", updated: "2026-10-31T10:00:00Z" };
const worldB = { id: "world-b", title: "Welt B", backupUrl: "", updated: "2026-10-31T10:05:00Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

// The world the gateway pointed at when each save left; "" means no world was selected.
let saves: { family: string; world: string; body?: string }[];
let selected: string;
let holdManuscriptB: ReturnType<typeof deferred<void>> | null;

beforeEach(() => {
  saves = [];
  selected = "";
  holdManuscriptB = null;
  history.replaceState(null, "", "/");
  const application = quiltorClient.application;
  vi.spyOn(application.worlds, "select").mockImplementation((id) => {
    selected = id;
  });
  vi.spyOn(application.worlds, "list").mockResolvedValue({ ok: true, worlds: [worldA] });
  vi.spyOn(application.worlds, "open").mockResolvedValue({ ok: true, world: worldA });
  vi.spyOn(application.worlds, "create").mockResolvedValue({ ok: true, world: worldB });
  vi.spyOn(application.manuscript, "load").mockImplementation(async () => {
    const world = selected;
    if (world === worldB.id && holdManuscriptB) await holdManuscriptB.promise;
    return {
      chapters: [
        {
          id: "chapter-1",
          title: "Eins",
          body: world === worldA.id ? "Anfang in A" : "Anfang in B",
          note: "",
        },
      ],
    };
  });
  vi.spyOn(application.storyWorld, "load").mockResolvedValue({ nodes: [], edges: [] });
  vi.spyOn(application.storyboards, "load").mockResolvedValue({
    boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
    nodes: [],
    edges: [],
  });
  const saved = { ok: true as const, zeit: "2026-10-31T10:10:00Z", revision: 4 };
  vi.spyOn(application.manuscript, "save").mockImplementation(async (value) => {
    saves.push({ family: "manuscript", world: selected, body: value.chapters[0]?.body });
    return saved;
  });
  vi.spyOn(application.storyWorld, "save").mockImplementation(async () => {
    saves.push({ family: "figures", world: selected });
    return saved;
  });
  vi.spyOn(application.storyboards, "save").mockImplementation(async () => {
    saves.push({ family: "storyboards", world: selected });
    return saved;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("documents stay bound to the world they were loaded for", () => {
  it("never saves a closed world's undo into the next world (P-R2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Welt A – Welt öffnen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anfang in A" }));
    await wait(1000);
    expect(saves).toEqual([{ family: "manuscript", world: worldA.id, body: "Entwurf in A" }]);

    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
    fireEvent.click(await screen.findByRole("button", { name: "Neue Welt" }));
    fireEvent.change(screen.getByPlaceholderText("Der letzte Garten"), {
      target: { value: "Welt B" },
    });
    const create = screen.getByRole("button", { name: "Welt erstellen" });
    create.focus();
    fireEvent.keyDown(create, { key: "z", ctrlKey: true });

    holdManuscriptB = deferred<void>();
    fireEvent.click(create);
    await waitFor(() => expect(selected).toBe(worldB.id));
    await wait(1000);
    holdManuscriptB.resolve();
    expect(await screen.findByRole("button", { name: "Anfang in B" })).toBeVisible();
    await wait(1000);

    expect(saves.filter((save) => save.world !== worldA.id)).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(
      warn.mock.calls.some((call) => String(call[0]).startsWith("[quiltor] save refused")),
    ).toBe(false);
  });
});
