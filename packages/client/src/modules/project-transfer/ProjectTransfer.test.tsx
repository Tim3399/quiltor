import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { ProjectExportDialog } from "./ProjectExportDialog";
import { ProjectImportDialog } from "./ProjectImportDialog";

const preview = (title: string) => ({
  title,
  counts: {
    chapters: 4,
    bookChapters: 2,
    setAsideChapters: 1,
    trashedChapters: 1,
    figures: 3,
    storyboards: 2,
    images: 5,
  },
  includes: { trash: true as const, history: false as const },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("Projektdatei"), { target: { files: [file] } });
}

describe("project import", () => {
  it("rejects an oversized archive before sending it for preview", async () => {
    const inspect = vi.spyOn(quiltorClient.application.projectTransfer, "preview");
    render(
      <I18nProvider>
        <ProjectImportDialog onImported={vi.fn()} onClose={vi.fn()} />
      </I18nProvider>,
    );
    const oversized = new File([], "too-large.quiltor");
    Object.defineProperty(oversized, "size", { value: 64 * 1024 * 1024 + 1 });
    choose(oversized);
    expect(await screen.findByRole("alert")).toHaveTextContent("größer als 64 MiB");
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Als neues Projekt importieren" })).toBeDisabled();
  });

  it("authorizes import only from the latest completed preview", async () => {
    let resolveFirst!: (value: { ok: true; preview: ReturnType<typeof preview> }) => void;
    const first = new Promise<{ ok: true; preview: ReturnType<typeof preview> }>((resolve) => {
      resolveFirst = resolve;
    });
    const inspect = vi
      .spyOn(quiltorClient.application.projectTransfer, "preview")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, preview: preview("Neue Fassung") });
    const onImported = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <ProjectImportDialog onImported={onImported} onClose={vi.fn()} />
      </I18nProvider>,
    );

    choose(new File(["first"], "first.quiltor"));
    choose(new File(["second"], "second.quiltor"));
    expect(await screen.findByText("Neue Fassung")).toBeInTheDocument();
    resolveFirst({ ok: true, preview: preview("Veraltete Fassung") });
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Veraltete Fassung")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Als neues Projekt importieren" })).toBeEnabled();
  });

  it("retains the reviewed archive after an import failure", async () => {
    vi.spyOn(quiltorClient.application.projectTransfer, "preview").mockResolvedValue({
      ok: true,
      preview: preview("Sicher geprüft"),
    });
    vi.spyOn(quiltorClient.application.projectTransfer, "importProject").mockRejectedValue(
      new Error("Import fehlgeschlagen"),
    );
    render(
      <I18nProvider>
        <ProjectImportDialog onImported={vi.fn()} onClose={vi.fn()} />
      </I18nProvider>,
    );
    choose(new File(["archive"], "project.quiltor"));
    fireEvent.click(await screen.findByRole("button", { name: "Als neues Projekt importieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import fehlgeschlagen");
    expect(screen.getByText("Sicher geprüft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Als neues Projekt importieren" })).toBeEnabled();
  });

  it("retries opening a committed import without publishing a duplicate project", async () => {
    const imported = {
      id: "new-world",
      title: "Sicher geprüft",
      backupUrl: "",
      updated: "2026-09-19T12:00:00Z",
    };
    vi.spyOn(quiltorClient.application.projectTransfer, "preview").mockResolvedValue({
      ok: true,
      preview: preview(imported.title),
    });
    const publish = vi
      .spyOn(quiltorClient.application.projectTransfer, "importProject")
      .mockResolvedValue({ ok: true, world: imported });
    const onImported = vi
      .fn()
      .mockRejectedValueOnce(new Error("opening failed"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ProjectImportDialog onImported={onImported} onClose={onClose} />
      </I18nProvider>,
    );
    choose(new File(["archive"], "project.quiltor"));
    fireEvent.click(await screen.findByRole("button", { name: "Als neues Projekt importieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wurde importiert");
    fireEvent.click(screen.getByRole("button", { name: "Importiertes Projekt öffnen" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(publish).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledTimes(2);
  });

  it("cannot close while a publishing request may still open the imported project", async () => {
    let finishImport!: (value: {
      ok: true;
      world: { id: string; title: string; backupUrl: string; updated: string };
    }) => void;
    vi.spyOn(quiltorClient.application.projectTransfer, "preview").mockResolvedValue({
      ok: true,
      preview: preview("Wartendes Projekt"),
    });
    vi.spyOn(quiltorClient.application.projectTransfer, "importProject").mockReturnValue(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ProjectImportDialog onImported={vi.fn()} onClose={onClose} />
      </I18nProvider>,
    );
    choose(new File(["archive"], "project.quiltor"));
    fireEvent.click(await screen.findByRole("button", { name: "Als neues Projekt importieren" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).not.toHaveBeenCalled();

    finishImport({
      ok: true,
      world: {
        id: "new-world",
        title: "Wartendes Projekt",
        backupUrl: "",
        updated: "2026-09-19T12:00:00Z",
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

describe("project export", () => {
  it("flushes first and keeps the dialog open when native saving is cancelled", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(quiltorClient.application.projectTransfer, "exportProject").mockResolvedValue(
      new Blob(["archive"], { type: "application/zip" }),
    );
    const save = vi
      .spyOn(quiltorClient.platform.files, "save")
      .mockResolvedValue({ status: "cancelled" });
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ProjectExportDialog worldId="world-1" flush={flush} onClose={onClose} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Projektdatei speichern" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("Quiltor-Projekt.quiltor", expect.any(Blob)),
    );
    expect(flush).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Quiltor-Projekt exportieren" })).toBeInTheDocument();
  });

  it("keeps export available after a native save failure", async () => {
    vi.spyOn(quiltorClient.application.projectTransfer, "exportProject").mockResolvedValue(
      new Blob(["archive"], { type: "application/zip" }),
    );
    vi.spyOn(quiltorClient.platform.files, "save").mockResolvedValue({
      status: "failed",
      error: "Datenträger voll",
    });
    render(
      <I18nProvider>
        <ProjectExportDialog worldId="world-1" flush={vi.fn()} onClose={vi.fn()} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Projektdatei speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Datenträger voll");
    expect(screen.getByRole("button", { name: "Projektdatei speichern" })).toBeEnabled();
  });
});
