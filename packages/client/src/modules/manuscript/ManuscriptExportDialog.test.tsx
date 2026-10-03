import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApplicationGatewayError, type ManuscriptDocxPreview, quiltorClient } from "../../platform";
import { ManuscriptExportDialog } from "./ManuscriptExportDialog";

const preview: ManuscriptDocxPreview = {
  preset: "editor",
  revision: 4,
  sourceSha256: "a".repeat(64),
  fileName: "Quiltor-Manuskript.docx",
  chapters: [{ id: "one", title: "Ankunft", words: 3, excerpt: "Mara wartet dort." }],
  counts: {
    manuscriptChapters: 2,
    manuscriptWords: 5,
    exportedChapters: 1,
    exportedWords: 3,
  },
  warnings: [{ code: "excluded_chapters", count: 1 }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderDialog(onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(
    <I18nProvider>
      <ManuscriptExportDialog preset="editor" onSave={onSave} onClose={onClose} />
    </I18nProvider>,
  );
  return { onSave, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManuscriptExportDialog", () => {
  it("saves before preview and again before the acknowledged download", async () => {
    const calls: string[] = [];
    const onSave = vi.fn(async () => {
      calls.push("save");
    });
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockImplementation(
      async () => {
        calls.push("preview");
        return { ok: true, preview };
      },
    );
    vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx").mockImplementation(
      async () => {
        calls.push("render");
        return new Blob(["docx"]);
      },
    );
    const save = vi
      .spyOn(quiltorClient.application.documents, "saveManuscriptDocx")
      .mockImplementation(async () => {
        calls.push("download");
        return "saved";
      });
    renderDialog(onSave);

    expect(await screen.findByText("Ankunft")).toBeInTheDocument();
    expect(screen.getByText("Nicht im Buch enthaltene Kapitel: 1")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Diese Inhalte bleiben im Projekt, werden aber nicht in die DOCX-Datei übernommen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wortzahlen beziehen sich auf den Kapiteltext ohne Überschriften."),
    ).toBeInTheDocument();
    const download = screen.getByRole("button", { name: "DOCX herunterladen" });
    expect(download).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Alle angezeigten Hinweise wurden geprüft",
      }),
    );
    fireEvent.click(download);

    await screen.findByText("Die DOCX-Datei wurde zum Speichern übergeben.");
    expect(calls).toEqual(["save", "preview", "save", "render", "download"]);
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "Quiltor-Manuskript.docx");
  });

  it("does not call the preview API when saving fails", async () => {
    const inspect = vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx");
    renderDialog(vi.fn().mockRejectedValue(new Error("save failed")));

    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("does not render when the save immediately before download fails", async () => {
    const onSave = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second save failed"));
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockResolvedValue({
      ok: true,
      preview: { ...preview, warnings: [] },
    });
    const renderDocx = vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx");
    renderDialog(onSave);

    fireEvent.click(await screen.findByRole("button", { name: "DOCX herunterladen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("second save failed");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(renderDocx).not.toHaveBeenCalled();
  });

  it("uses an untitled fallback and stays neutral when file saving is cancelled", async () => {
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockResolvedValue({
      ok: true,
      preview: {
        ...preview,
        chapters: [{ ...preview.chapters[0], title: "" }],
        warnings: [],
      },
    });
    vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx").mockResolvedValue(
      new Blob(["docx"]),
    );
    vi.spyOn(quiltorClient.application.documents, "saveManuscriptDocx").mockResolvedValue(
      "cancelled",
    );
    renderDialog();

    expect(await screen.findByRole("heading", { name: "Ohne Titel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "DOCX herunterladen" }));

    await waitFor(() =>
      expect(quiltorClient.application.documents.saveManuscriptDocx).toHaveBeenCalledOnce(),
    );
    expect(
      screen.queryByText("Die DOCX-Datei wurde zum Speichern übergeben."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires a fresh preview after a revision mismatch", async () => {
    const inspect = vi
      .spyOn(quiltorClient.application.documents, "previewManuscriptDocx")
      .mockResolvedValue({ ok: true, preview });
    vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx").mockRejectedValue(
      new ApplicationGatewayError("conflict", "manuscript_export.preview_mismatch", {
        category: "conflict",
      }),
    );
    const saveDocx = vi.spyOn(quiltorClient.application.documents, "saveManuscriptDocx");
    renderDialog();
    await screen.findByText("Ankunft");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Alle angezeigten Hinweise wurden geprüft",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "DOCX herunterladen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Manuskript hat sich seit der Vorschau geändert",
    );
    expect(screen.queryByText("Ankunft")).not.toBeInTheDocument();
    expect(saveDocx).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vorschau neu laden" }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
  });

  it("keeps file-save failure separate from successful DOCX rendering", async () => {
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockResolvedValue({
      ok: true,
      preview: { ...preview, warnings: [] },
    });
    vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx").mockResolvedValue(
      new Blob(["docx"]),
    );
    vi.spyOn(quiltorClient.application.documents, "saveManuscriptDocx").mockRejectedValue(
      new Error("disk full"),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "DOCX herunterladen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die DOCX-Datei konnte nicht gespeichert werden. disk full",
    );
  });

  it("ignores a preview that resolves after cancellation and prevents duplicate downloads", async () => {
    const pendingPreview = deferred<{ ok: true; preview: ManuscriptDocxPreview }>();
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockReturnValue(
      pendingPreview.promise,
    );
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    pendingPreview.resolve({ ok: true, preview });
    await Promise.resolve();

    const pendingRender = deferred<Blob>();
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockResolvedValue({
      ok: true,
      preview: { ...preview, warnings: [] },
    });
    const renderDocx = vi
      .spyOn(quiltorClient.application.documents, "renderManuscriptDocx")
      .mockReturnValue(pendingRender.promise);
    vi.spyOn(quiltorClient.application.documents, "saveManuscriptDocx").mockResolvedValue("saved");
    renderDialog();
    const download = await screen.findByRole("button", { name: "DOCX herunterladen" });
    fireEvent.click(download);
    fireEvent.click(download);
    await waitFor(() => expect(renderDocx).toHaveBeenCalledOnce());
    pendingRender.resolve(new Blob(["docx"]));
  });

  it("does not save a rendered file after the dialog unmounts", async () => {
    const pendingRender = deferred<Blob>();
    vi.spyOn(quiltorClient.application.documents, "previewManuscriptDocx").mockResolvedValue({
      ok: true,
      preview: { ...preview, warnings: [] },
    });
    vi.spyOn(quiltorClient.application.documents, "renderManuscriptDocx").mockReturnValue(
      pendingRender.promise,
    );
    const save = vi.spyOn(quiltorClient.application.documents, "saveManuscriptDocx");
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "DOCX herunterladen" }));
    cleanup();

    pendingRender.resolve(new Blob(["docx"]));
    await Promise.resolve();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
  });
});
