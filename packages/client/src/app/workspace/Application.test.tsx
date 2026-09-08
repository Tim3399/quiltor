import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { FigureState } from "../../modules/story-world";
import { quiltorClient } from "../../platform";
import { App } from "../Application";
import type { LoadedWorldDocuments } from "../world/useWorldSession";

const actions = vi.hoisted(() => ({ close: vi.fn(), logout: vi.fn() }));

vi.mock("../world/useWorldSession", () => ({
  useWorldSession: (load: (documents: LoadedWorldDocuments) => void) => {
    useEffect(
      () =>
        load({
          manuscript: { chapters: [] },
          figures: { nodes: [{ id: "ada", name: "Ada", x: 0, y: 0, sub: "original" }], edges: [] },
          storyboards: { boards: [], nodes: [], edges: [] },
          orphanedMentions: 0,
        }),
      [load],
    );
    return { worlds: [], world: { id: "test-world", title: "Test World" }, close: actions.close };
  },
}));
vi.mock("../shell/useShellStatus", () => ({
  useShellStatus: () => ({ account: { email: "author@example.org" }, logout: actions.logout }),
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
    figures,
    onFiguresChange,
  }: {
    figures: FigureState;
    onFiguresChange: (value: FigureState) => void;
  }) => (
    <button
      onClick={() =>
        onFiguresChange({
          ...figures,
          nodes: figures.nodes.map((node) => ({ ...node, sub: "unsaved draft" })),
        })
      }
    >
      {figures.nodes[0].sub}
    </button>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  actions.close.mockClear();
  actions.logout.mockClear();
});

describe("application save barriers", () => {
  it.each([
    ["Zur Weltauswahl", "close"],
    ["Abmelden", "logout"],
  ] as const)(
    "keeps the draft and visible save failure before %s, then permits retry",
    async (menuItem, action) => {
      const save = vi
        .spyOn(quiltorClient.application.storyWorld, "save")
        .mockRejectedValueOnce(new Error("Draft could not be saved"))
        .mockResolvedValue({ ok: true, zeit: "2026-09-08", revision: 1 });
      render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "original" }));
      fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
      fireEvent.click(screen.getByRole("menuitem", { name: menuItem }));
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(await screen.findByRole("alert")).toHaveTextContent("Draft could not be saved");
      expect(screen.getByRole("button", { name: "unsaved draft" })).toBeVisible();
      expect(actions[action]).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
      fireEvent.click(screen.getByRole("menuitem", { name: menuItem }));
      await waitFor(() => expect(actions[action]).toHaveBeenCalledOnce());
      expect(save.mock.calls[1][0].nodes[0].sub).toBe("unsaved draft");
    },
  );
});
