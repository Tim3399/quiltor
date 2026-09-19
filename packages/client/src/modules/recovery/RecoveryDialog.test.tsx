import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import type { StoryboardState } from "../storyboard";
import { RecoveryDialog } from "./RecoveryDialog";
import type { PersistedRecoveryDocuments } from "./recoveryExport";

const figures: FigureState = {
  nodes: [{ id: "ada", name: "Ada", kind: "figure", x: 1, y: 2, note: "Mutig" }],
  edges: [],
};
const storyboards: StoryboardState = {
  boards: [{ id: "main", title: "Bogen" }],
  nodes: [],
  edges: [],
};
const persisted: PersistedRecoveryDocuments = {
  manuscript: { document: manuscript("Gespeicherter Text"), revision: 4 },
  figures: { document: { nodes: [], edges: [] }, revision: 6 },
  storyboards: { document: { boards: [], nodes: [], edges: [] }, revision: 3 },
};

function manuscript(body: string): Manuscript {
  return { chapters: [{ id: "one", title: "Anfang", body, note: "Plan" }] };
}

function renderDialog(value = manuscript("Erster Stand"), onClose = vi.fn()) {
  return render(
    <I18nProvider>
      <RecoveryDialog
        manuscript={value}
        figures={figures}
        storyboards={storyboards}
        onClose={onClose}
      />
    </I18nProvider>,
  );
}

async function blobText(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("failed-save recovery", () => {
  it("copies the latest in-memory manuscript without saving first", async () => {
    const copy = vi.spyOn(quiltorClient.platform.clipboard, "writeText").mockResolvedValue();
    const view = renderDialog();
    view.rerender(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Neueste ungespeicherte Änderung")}
          figures={figures}
          storyboards={storyboards}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext kopieren" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith("Anfang\n\nNeueste ungespeicherte Änderung"),
    );
  });

  it("downloads a JSON rescue containing every current document family", async () => {
    const save = vi
      .spyOn(quiltorClient.platform.files, "save")
      .mockResolvedValue({ status: "saved" });
    renderDialog(manuscript("Ungespeichert"));

    fireEvent.click(screen.getByRole("button", { name: "Dokumentdaten als JSON herunterladen" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const [name, blob] = save.mock.calls[0];
    expect(name).toBe("Quiltor-Dokumente-Rettung.json");
    expect(JSON.parse(await blobText(blob))).toMatchObject({
      format: "quiltor-recovery",
      version: 1,
      manuscript: manuscript("Ungespeichert"),
      figures,
      storyboards,
    });
  });

  it("keeps the latest text available after clipboard and file failures", async () => {
    const copy = vi
      .spyOn(quiltorClient.platform.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue();
    const save = vi
      .spyOn(quiltorClient.platform.files, "save")
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValue({ status: "saved" });
    const view = renderDialog(manuscript("Bleibt erhalten"));

    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext kopieren" }));
    expect(await screen.findByText(/Ausgabe ist fehlgeschlagen/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext kopieren" }));
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith("Anfang\n\nBleibt erhalten"));

    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext herunterladen" }));
    expect(await screen.findByText(/Ausgabe ist fehlgeschlagen/)).toBeVisible();
    view.rerender(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Noch neuer")}
          figures={figures}
          storyboards={storyboards}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext herunterladen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(await blobText(save.mock.calls[1][1])).toBe("Anfang\n\nNoch neuer");
  });

  it("closes without changing the supplied documents", () => {
    const onClose = vi.fn();
    const value = manuscript("Offener Entwurf");
    renderDialog(value, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(value.chapters[0].body).toBe("Offener Entwurf");
  });

  it("treats a cancelled download neutrally and prevents competing exports", async () => {
    let finish!: (result: { status: "cancelled" }) => void;
    vi.spyOn(quiltorClient.platform.files, "save").mockImplementation(
      () =>
        new Promise<{ status: "cancelled" }>((resolve) => {
          finish = resolve;
        }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Manuskripttext herunterladen" }));
    expect(screen.getByRole("button", { name: "Manuskripttext kopieren" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Dokumentdaten als JSON herunterladen" }),
    ).toBeDisabled();
    finish({ status: "cancelled" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manuskripttext kopieren" })).toBeEnabled(),
    );
    expect(screen.queryByText("Der aktuelle Stand wurde heruntergeladen.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ausgabe ist fehlgeschlagen/)).not.toBeInTheDocument();
  });

  it("compares against a peek without losing edits made while the read is pending", async () => {
    let finish!: (value: PersistedRecoveryDocuments) => void;
    const compare = vi.fn(
      () =>
        new Promise<PersistedRecoveryDocuments>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Entwurf vor dem Lesen")}
          figures={figures}
          storyboards={storyboards}
          onCompare={compare}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));
    view.rerender(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Änderung während des Lesens")}
          figures={figures}
          storyboards={storyboards}
          onCompare={compare}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    finish(persisted);

    expect(await screen.findByText(/Änderung während des Lesens/)).toBeVisible();
    expect(screen.getByText(/Gespeicherter Text/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Meine Planung" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Gespeicherte Planung" })).toBeVisible();
  });

  it("authorizes an explicit choice only after both versions were downloaded", async () => {
    const fileSave = vi
      .spyOn(quiltorClient.platform.files, "save")
      .mockResolvedValueOnce({ status: "cancelled" })
      .mockResolvedValue({ status: "saved" });
    const keepLocal = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const local = manuscript("Mein Konflikttext");
    const view = render(
      <I18nProvider>
        <RecoveryDialog
          manuscript={local}
          figures={figures}
          storyboards={storyboards}
          onCompare={async () => persisted}
          onKeepLocal={keepLocal}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));
    await screen.findByText(/Gespeicherter Text/);
    const keep = screen.getByRole("button", {
      name: "Meinen Entwurf als neue Fassung speichern",
    });
    expect(keep).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Beide Fassungen als JSON herunterladen" }));
    await waitFor(() => expect(fileSave).toHaveBeenCalledOnce());
    expect(keep).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Beide Fassungen als JSON herunterladen" }));
    await waitFor(() => expect(keep).toBeEnabled());
    const rescue = JSON.parse(await blobText(fileSave.mock.calls[1][1]));
    expect(rescue).toMatchObject({
      format: "quiltor-conflict-recovery",
      version: 1,
      local: { manuscript: local, figures, storyboards },
      persisted: { manuscript: persisted.manuscript.document },
      persistedRevisions: { manuscript: 4, figures: 6, storyboards: 3 },
    });

    view.rerender(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Nach der Rettung weitergeschrieben")}
          figures={figures}
          storyboards={storyboards}
          onCompare={async () => persisted}
          onKeepLocal={keepLocal}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    expect(keep).toBeDisabled();
    expect(keepLocal).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not authorize a rescue that finishes after the local draft changed", async () => {
    let finish!: (result: { status: "saved" }) => void;
    vi.spyOn(quiltorClient.platform.files, "save").mockImplementation(
      () =>
        new Promise<{ status: "saved" }>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Vor dem Download")}
          figures={figures}
          storyboards={storyboards}
          conflictFamily="manuscript"
          onCompare={async () => persisted}
          onKeepLocal={vi.fn()}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));
    await screen.findByText(/Gespeicherter Text/);
    fireEvent.click(screen.getByRole("button", { name: "Beide Fassungen als JSON herunterladen" }));
    view.rerender(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Während des Downloads geändert")}
          figures={figures}
          storyboards={storyboards}
          conflictFamily="manuscript"
          onCompare={async () => persisted}
          onKeepLocal={vi.fn()}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    finish({ status: "saved" });

    expect(await screen.findByText(/während des Vergleichs geändert/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Meinen Entwurf als neue Fassung speichern" }),
    ).toBeDisabled();
    expect(screen.queryByText(/Beide Fassungen wurden heruntergeladen/)).not.toBeInTheDocument();
  });

  it("shows the affected family and exposes equal-count planning differences", async () => {
    const persistedWithDifferentNote: PersistedRecoveryDocuments = {
      ...persisted,
      figures: {
        revision: 7,
        document: {
          nodes: [{ id: "ada", name: "Ada", kind: "figure", x: 1, y: 2, note: "Vorsichtig" }],
          edges: [],
        },
      },
    };
    render(
      <I18nProvider>
        <RecoveryDialog
          manuscript={manuscript("Mein Text")}
          figures={figures}
          storyboards={storyboards}
          conflictFamily="figures"
          onCompare={async () => persistedWithDifferentNote}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));

    expect(await screen.findByText("Diese Entscheidung betrifft: Welt und Figuren.")).toBeVisible();
    const disclosures = screen.getAllByText("Planungsdaten vollständig anzeigen");
    fireEvent.click(disclosures[0]);
    fireEvent.click(disclosures[1]);
    expect(screen.getByText(/Mutig/)).toBeVisible();
    expect(screen.getByText(/Vorsichtig/)).toBeVisible();
  });
});
