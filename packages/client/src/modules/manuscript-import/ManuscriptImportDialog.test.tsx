import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { ManuscriptImportPreview } from "../../platform";
import { quiltorClient } from "../../platform";
import { ManuscriptImportDialog } from "./ManuscriptImportDialog";

const world = {
  id: "imported-world",
  title: "Hafenroman",
  backupUrl: "",
  updated: "2026-10-02T12:00:00Z",
};

function chapter(index: number, title = `Kapitel ${index + 1}`) {
  return {
    sourceIndexes: [index],
    title,
    folderPath: [] as string[],
    body: index === 0 ? "😀 Mara wartet am Hafen." : `Text aus ${title}.`,
    marks:
      index === 0
        ? [
            { from: 3, to: 7, kind: "bold" as const },
            { from: 8, to: 14, kind: "italic" as const },
          ]
        : [],
  };
}

function preview(
  title = "Hafenroman",
  chapters = [chapter(0, "Ankunft"), chapter(1, "Sturm"), chapter(2, "Heimkehr")],
): ManuscriptImportPreview {
  return {
    format: "docx",
    fileName: "Hafen.docx",
    sourceSha256: "a".repeat(64),
    title,
    units: chapters.flatMap((item) =>
      item.sourceIndexes.map((index) => ({
        index,
        text: item.body,
        marks: item.marks,
        isHeading: false,
      })),
    ),
    chapters,
    counts: {
      sourceWords: 18,
      sourceParagraphs: chapters.flatMap((item) => item.sourceIndexes).length,
      importedWords: 18,
      importedParagraphs: 6,
    },
    warnings: [{ code: "images", count: 1 }],
  };
}

function renderDialog(onImported = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(
    <I18nProvider>
      <ManuscriptImportDialog onImported={onImported} onClose={onClose} />
    </I18nProvider>,
  );
  return { onImported, onClose };
}

function choose(name = "Hafen.docx", body = "docx") {
  fireEvent.change(screen.getByLabelText("Manuskriptdatei"), {
    target: { files: [new File([body], name)] },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("manuscript import dialog", () => {
  it("reviews counts, formatted text and explicit warnings before publishing", async () => {
    vi.spyOn(quiltorClient.application.manuscriptImport, "createRequestId").mockReturnValue(
      "request-one",
    );
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview").mockResolvedValue({
      ok: true,
      preview: preview(),
    });
    const publish = vi
      .spyOn(quiltorClient.application.manuscriptImport, "importManuscript")
      .mockResolvedValue({ ok: true, world });
    const { onClose } = renderDialog();

    choose();
    expect(await screen.findAllByText("18", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText("Bilder: 1 erkannt und geprüft")).toBeInTheDocument();
    expect(
      screen.getByText("Bilder werden nicht in das neue Projekt übernommen."),
    ).toBeInTheDocument();
    expect(screen.queryByText("😀 Mara wartet am Hafen.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Kapiteltext prüfen: Ankunft"));
    const body = (await screen.findByText("Mara")).closest("p");
    expect(body).not.toBeNull();
    if (!body) throw new Error("formatted chapter preview missing");
    expect(within(body).getByText("Mara").tagName).toBe("STRONG");
    expect(within(body).getByText("wartet").tagName).toBe("EM");

    const submit = screen.getByRole("button", { name: "Als neues Projekt importieren" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Bilder: 1 erkannt und geprüft/ }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSha256: "a".repeat(64),
        title: "Hafenroman",
        acknowledgedWarnings: ["images"],
        requestId: "request-one",
      }),
    );
  });

  it("requires a refreshed server preview after title edits and adjacent merging", async () => {
    const initialPreview = preview();
    initialPreview.chapters[0].folderPath = ["Teil I"];
    initialPreview.chapters[1].folderPath = ["Teil II"];
    const mergedPreview = preview("Neuer Projekttitel", [
      {
        sourceIndexes: [0, 1],
        title: "Ankunft",
        folderPath: ["Teil I"],
        body: "😀 Mara wartet am Hafen.\n\nSturm",
        marks: [{ from: 3, to: 7, kind: "bold" }],
      },
      chapter(2, "Heimkehr"),
    ]);
    const inspect = vi
      .spyOn(quiltorClient.application.manuscriptImport, "preview")
      .mockResolvedValueOnce({ ok: true, preview: initialPreview })
      .mockResolvedValueOnce({ ok: true, preview: mergedPreview });
    vi.spyOn(quiltorClient.application.manuscriptImport, "createRequestId")
      .mockReturnValueOnce("source-request")
      .mockReturnValue("edited-request");
    renderDialog();
    choose();
    await screen.findByLabelText("Projekttitel");

    fireEvent.change(screen.getByLabelText("Projekttitel"), {
      target: { value: "Neuer Projekttitel" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Mit vorherigem Kapitel zusammenführen" })[0],
    );
    expect(screen.getByRole("button", { name: "Als neues Projekt importieren" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Vorschau aktualisieren" }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    expect(inspect.mock.calls[1][1]).toEqual({
      title: "Neuer Projekttitel",
      chapters: [
        { sourceIndexes: [0, 1], title: "Ankunft", folderPath: ["Teil I"] },
        { sourceIndexes: [2], title: "Heimkehr", folderPath: [] },
      ],
    });
    expect(await screen.findByLabelText("Titel von Kapitel 2")).toHaveValue("Heimkehr");
    expect(screen.queryByLabelText("Titel von Kapitel 3")).not.toBeInTheDocument();
  });

  it("splits at a reviewed unit, edits a nested folder, and refreshes the server preview", async () => {
    const sourcePreview: ManuscriptImportPreview = {
      ...preview("Hafenroman", [
        {
          sourceIndexes: [0, 1, 2],
          title: "Ankunft",
          folderPath: [],
          body: "Ankunft\n\nMara wartet.\n\nSturm",
          marks: [],
        },
      ]),
      format: "markdown",
      fileName: "Hafen.md",
      units: [
        { index: 0, text: "Ankunft", marks: [], isHeading: true },
        { index: 1, text: "Mara wartet.", marks: [], isHeading: false },
        { index: 2, text: "Sturm", marks: [], isHeading: true },
      ],
      counts: {
        sourceWords: 4,
        sourceParagraphs: 3,
        importedWords: 4,
        importedParagraphs: 3,
      },
    };
    const refreshed: ManuscriptImportPreview = {
      ...sourcePreview,
      chapters: [
        {
          sourceIndexes: [0, 1],
          title: "Ankunft",
          folderPath: ["Teil I", "Hafen"],
          body: "Mara wartet.",
          marks: [],
        },
        {
          sourceIndexes: [2],
          title: "Sturm",
          folderPath: ["Teil I", "Hafen"],
          body: "",
          marks: [],
        },
      ],
    };
    const inspect = vi
      .spyOn(quiltorClient.application.manuscriptImport, "preview")
      .mockResolvedValueOnce({ ok: true, preview: sourcePreview })
      .mockResolvedValueOnce({ ok: true, preview: refreshed });
    renderDialog();
    choose("Hafen.md", "# Ankunft\n\nMara wartet.\n\n# Sturm");

    const folder = await screen.findByLabelText("Ordnerpfad für Kapitel 1");
    fireEvent.change(folder, { target: { value: "Teil I / Hafen" } });
    fireEvent.click(screen.getByText("Kapitel 1 teilen"));
    const splitBoundary = await screen.findByRole("button", {
      name: "Vor Absatz 3 teilen: Sturm",
    });
    splitBoundary.focus();
    fireEvent.keyDown(splitBoundary, { key: "Enter", code: "Enter" });
    fireEvent.click(splitBoundary, { detail: 0 });
    const newChapterTitle = screen.getByLabelText("Titel von Kapitel 2");
    expect(newChapterTitle).toHaveValue("Sturm");
    expect(newChapterTitle).toHaveFocus();
    expect(screen.getByLabelText("Ordnerpfad für Kapitel 2")).toHaveValue("Teil I / Hafen");

    fireEvent.click(screen.getByRole("button", { name: "Vorschau aktualisieren" }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    expect(inspect.mock.calls[1][1]).toEqual({
      title: "Hafenroman",
      chapters: [
        { sourceIndexes: [0, 1], title: "Ankunft", folderPath: ["Teil I", "Hafen"] },
        { sourceIndexes: [2], title: "Sturm", folderPath: ["Teil I", "Hafen"] },
      ],
    });
    expect(await screen.findByLabelText("Ordnerpfad für Kapitel 1")).toHaveValue("Teil I/Hafen");
  });

  it("offers every supported manuscript file extension", () => {
    renderDialog();
    expect(screen.getByLabelText("Manuskriptdatei")).toHaveAttribute(
      "accept",
      expect.stringContaining(".docx,.md,.markdown,.txt"),
    );
  });

  it("locks selection edits during a delayed refresh and becomes editable again", async () => {
    let finishRefresh!: (value: { ok: true; preview: ManuscriptImportPreview }) => void;
    const delayed = new Promise<{ ok: true; preview: ManuscriptImportPreview }>((resolve) => {
      finishRefresh = resolve;
    });
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview")
      .mockResolvedValueOnce({ ok: true, preview: preview() })
      .mockReturnValueOnce(delayed);
    renderDialog();
    choose();
    const title = await screen.findByLabelText("Projekttitel");
    fireEvent.change(title, { target: { value: "Geprüfter Titel" } });
    fireEvent.click(screen.getByRole("button", { name: "Vorschau aktualisieren" }));
    expect(screen.getByLabelText("Projekttitel")).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "Mit vorherigem Kapitel zusammenführen" })[0],
    ).toBeDisabled();

    finishRefresh({ ok: true, preview: preview("Geprüfter Titel") });

    await waitFor(() => expect(screen.getByLabelText("Projekttitel")).toBeEnabled());
    expect(
      screen.queryByRole("button", { name: "Vorschau aktualisieren" }),
    ).not.toBeInTheDocument();
  });

  it("ignores a stale file preview and retains the selected file after preview failure", async () => {
    let resolveFirst!: (value: { ok: true; preview: ManuscriptImportPreview }) => void;
    const first = new Promise<{ ok: true; preview: ManuscriptImportPreview }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        ok: true,
        preview: { ...preview("Zweite Datei"), fileName: "Neu.docx" },
      })
      .mockRejectedValueOnce(new Error("Vorschau fehlgeschlagen"));
    renderDialog();

    choose("Alt.docx", "old");
    choose("Neu.docx", "new");
    expect(await screen.findByDisplayValue("Zweite Datei")).toBeInTheDocument();
    resolveFirst({ ok: true, preview: { ...preview("Veraltet"), fileName: "Alt.docx" } });
    await waitFor(() => expect(screen.queryByDisplayValue("Veraltet")).not.toBeInTheDocument());

    choose("Fehler.docx", "bad");
    expect(await screen.findByRole("alert")).toHaveTextContent("Vorschau fehlgeschlagen");
    expect((screen.getByLabelText("Manuskriptdatei") as HTMLInputElement).files?.[0]?.name).toBe(
      "Fehler.docx",
    );
  });

  it("keeps the request id stable across publication failure and retry", async () => {
    vi.spyOn(quiltorClient.application.manuscriptImport, "createRequestId").mockReturnValue(
      "stable-request",
    );
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview").mockResolvedValue({
      ok: true,
      preview: { ...preview(), warnings: [] },
    });
    const publish = vi
      .spyOn(quiltorClient.application.manuscriptImport, "importManuscript")
      .mockRejectedValueOnce(new Error("Antwort verloren"))
      .mockResolvedValueOnce({ ok: true, world });
    renderDialog();
    choose();

    const submit = await screen.findByRole("button", { name: "Als neues Projekt importieren" });
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Antwort verloren");
    fireEvent.click(submit);
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls.map(([request]) => request.requestId)).toEqual([
      "stable-request",
      "stable-request",
    ]);
  });

  it("retries opening a committed world without publishing it again", async () => {
    vi.spyOn(quiltorClient.application.manuscriptImport, "createRequestId").mockReturnValue(
      "stable-request",
    );
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview").mockResolvedValue({
      ok: true,
      preview: { ...preview(), warnings: [] },
    });
    const publish = vi
      .spyOn(quiltorClient.application.manuscriptImport, "importManuscript")
      .mockResolvedValue({ ok: true, world });
    const onImported = vi
      .fn()
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce(undefined);
    const { onClose } = renderDialog(onImported);
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "Als neues Projekt importieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geöffnet");
    fireEvent.click(screen.getByRole("button", { name: "Importiertes Projekt öffnen" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(publish).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledTimes(2);
  });

  it("keeps close actions disabled while publication is unresolved", async () => {
    let resolveImport!: (value: { ok: true; world: typeof world }) => void;
    vi.spyOn(quiltorClient.application.manuscriptImport, "createRequestId").mockReturnValue(
      "request",
    );
    vi.spyOn(quiltorClient.application.manuscriptImport, "preview").mockResolvedValue({
      ok: true,
      preview: { ...preview(), warnings: [] },
    });
    vi.spyOn(quiltorClient.application.manuscriptImport, "importManuscript").mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const { onClose } = renderDialog();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "Als neues Projekt importieren" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    resolveImport({ ok: true, world });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
