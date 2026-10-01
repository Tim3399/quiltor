import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { FigureState } from "../../modules/story-world";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
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

  it("rescues the latest in-memory documents while every save attempt rejects", async () => {
    const save = vi
      .spyOn(quiltorClient.application.storyWorld, "save")
      .mockRejectedValue(new Error("Local storage failed"));
    const exportFile = vi
      .spyOn(quiltorClient.platform.files, "save")
      .mockResolvedValue({ status: "saved" });
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "original" }));
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent("Local storage failed");
    expect(screen.queryByText(/^Gespeichert/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entwurf retten" }));
    fireEvent.click(screen.getByRole("button", { name: "Dokumentdaten als JSON herunterladen" }));
    await waitFor(() => expect(exportFile).toHaveBeenCalledOnce());
    const reader = new FileReader();
    const exported = new Promise<string>((resolve, reject) => {
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
    });
    reader.readAsText(exportFile.mock.calls[0][1]);
    expect(JSON.parse(await exported).figures.nodes[0].sub).toBe("unsaved draft");

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.getByRole("button", { name: "unsaved draft" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ sub: "unsaved draft" })],
      }),
    );
    expect(screen.queryByText(/^Gespeichert/)).not.toBeInTheDocument();
  });

  it.each([
    ["Meinen Entwurf als neue Fassung speichern", "unsaved draft"],
    ["Gespeicherte Fassung übernehmen", "persisted"],
  ] as const)(
    "resolves a figure conflict with the explicit %s choice",
    async (choice, expected) => {
      vi.spyOn(quiltorClient.application.storyWorld, "save").mockRejectedValueOnce(
        new ApplicationGatewayError("Konflikt", "document.revision_conflict", {
          category: "conflict",
        }),
      );
      const saveExpected = vi
        .spyOn(quiltorClient.application.storyWorld, "saveExpected")
        .mockResolvedValue({ ok: true, zeit: "12:00", revision: 9 });
      vi.spyOn(quiltorClient.application.manuscript, "peek").mockResolvedValue({
        document: { chapters: [] },
        revision: 2,
      });
      vi.spyOn(quiltorClient.application.storyWorld, "peek").mockResolvedValue({
        document: {
          nodes: [{ id: "ada", name: "Ada", x: 0, y: 0, sub: "persisted" }],
          edges: [],
        },
        revision: 8,
      });
      vi.spyOn(quiltorClient.application.storyboards, "peek").mockResolvedValue({
        document: { boards: [], nodes: [], edges: [] },
        revision: 3,
      });
      vi.spyOn(quiltorClient.platform.files, "save").mockResolvedValue({ status: "saved" });
      render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "original" }));
      fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
      await screen.findByText("Konflikt");
      fireEvent.click(screen.getByRole("button", { name: "Entwurf retten" }));
      fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));
      await screen.findByRole("heading", { name: "Gespeicherte Planung" });
      fireEvent.click(
        screen.getByRole("button", { name: "Beide Fassungen als JSON herunterladen" }),
      );
      const resolution = await screen.findByRole("button", { name: choice });
      await waitFor(() => expect(resolution).toBeEnabled());
      fireEvent.click(resolution);

      await waitFor(() => expect(screen.getByRole("button", { name: expected })).toBeVisible());
      if (expected === "unsaved draft") {
        expect(saveExpected).toHaveBeenCalledWith(
          expect.objectContaining({
            nodes: [expect.objectContaining({ sub: "unsaved draft" })],
          }),
          8,
        );
      } else {
        expect(saveExpected).not.toHaveBeenCalled();
      }
    },
  );
});
