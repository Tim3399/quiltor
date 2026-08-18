import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import { LanguageProvider } from "../../language";
import { api } from "../../lib/api";
import type { Manuscript } from "../../types";

const manuscript = { chapters: [{ id: "c1", title: "Prolog", body: "Hallo Welt", note: "" }] };
const figures = { nodes: [{ id: "n1", x: 0, y: 0, name: "Testfigur" }], edges: [] };

function renderWorkspace(props: React.ComponentProps<typeof TextWorkspace>) {
  return render(
    <LanguageProvider>
      <TextWorkspace {...props} />
    </LanguageProvider>,
  );
}

describe("TextWorkspace", () => {
  it("ändert Text ohne die übrige Manuskriptstruktur zu verlieren", async () => {
    const onChange = vi.fn();
    renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn() });
    const editor = screen.getByLabelText("Kapiteltext");
    editor.textContent = "Neuer Text";
    fireEvent.input(editor, { inputType: "insertText", data: "Neuer Text" });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          chapters: [expect.objectContaining({ id: "c1", body: "Neuer Text" })],
        }),
      ),
    );
  });

  it("macht den Fokusmodus explizit verlassbar", () => {
    renderWorkspace({ manuscript, figures, onChange: vi.fn(), focus: true, onFocus: vi.fn() });
    expect(screen.getByRole("button", { name: /Fokusmodus verlassen/ })).toBeVisible();
  });

  it("wechselt im Fokusmodus subtil zwischen Kapiteln", () => {
    const twoChapters = {
      chapters: [
        ...manuscript.chapters,
        { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
      ],
    };
    const view = renderWorkspace({
      manuscript: twoChapters,
      figures,
      onChange: vi.fn(),
      focus: true,
      onFocus: vi.fn(),
    });
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole("button", { name: "Kapitelauswahl öffnen" }));
    const picker = rendered.getByRole("complementary", { name: "Kapitelauswahl im Fokusmodus" });
    expect(within(picker).getByRole("button", { name: /Prolog/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(picker).getByRole("button", { name: /Aufbruch/ }));
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Aufbruch");
    expect(rendered.getByLabelText("Kapiteltext")).toHaveTextContent("Der Weg beginnt.");
  });

  it("blendet die Kapitelauswahl bei nur einem Kapitel aus", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: true,
      onFocus: vi.fn(),
    });
    expect(
      within(view.container).queryByRole("combobox", { name: "Kapitel im Fokusmodus auswählen" }),
    ).not.toBeInTheDocument();
  });

  it("ändert persistierbare Panelbreiten auch per Tastatur", () => {
    const onSidebarWidth = vi.fn(),
      onInspectorWidth = vi.fn();
    renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
      sidebarWidth: 246,
      inspectorWidth: 294,
      onSidebarWidth,
      onInspectorWidth,
    });
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Navigation breiter oder schmaler ziehen" }),
      { key: "ArrowRight" },
    );
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Schreibhilfe breiter oder schmaler ziehen" }),
      { key: "ArrowLeft" },
    );
    expect(onSidebarWidth).toHaveBeenCalledWith(256);
    expect(onInspectorWidth).toHaveBeenCalledWith(304);
  });

  it("lässt beide Spalten auf demselben Weg wieder aufmachen", () => {
    // Zugeklappt gab es keinen Weg zurück: die Kapitelspalte hatte einen
    // Schließknopf, aber der einzige Öffner war ein unbeschriftetes Symbol in
    // der Titelleiste. Beide Spalten hängen jetzt an einem Schalterpaar.
    const onBinderOpen = vi.fn(),
      onInspectorOpen = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: false,
      inspectorOpen: false,
      onBinderOpen,
      onInspectorOpen,
    });
    const rendered = within(view.container);
    const chapters = rendered.getByRole("button", { name: "Kapitel" });
    expect(chapters).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chapters);
    expect(onBinderOpen).toHaveBeenCalledWith(true);
    fireEvent.click(rendered.getByRole("button", { name: "Schreibhilfe" }));
    expect(onInspectorOpen).toHaveBeenCalledWith(true);
  });

  // Die rechte Spalte macht nur noch eine Sache. Alles Kapitelbezogene ist links oder über
  // dem Text; der frühere Reiterwechsel im Inspector entfällt ersatzlos.
  it("hält im rechten Panel nur noch die Schreibhilfe", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const aid = within(view.container.querySelector(".inspector")!);
    expect(view.container.querySelector(".panel-tabs")).toBeNull();
    expect(aid.getByRole("tab", { name: "Nachschlagen" })).toBeTruthy();
    expect(aid.queryByRole("tab", { name: "Kapitel" })).toBeNull();
    expect(aid.queryByLabelText("Kapitelnotiz")).toBeNull();
    expect(aid.queryByRole("button", { name: "Kapitel löschen" })).toBeNull();
    expect(aid.queryByRole("button", { name: "Nach oben" })).toBeNull();
  });

  // Die Notiz gehört dem Kapitel, das die Liste auswählt -- also steht sie unter der Liste.
  it("speichert die Kapitelnotiz aus der linken Spalte", () => {
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const binder = within(view.container.querySelector(".binder")!);
    fireEvent.change(binder.getByLabelText("Kapitelnotiz"), {
      target: { value: "Die Unruhe nur andeuten." },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chapters: [expect.objectContaining({ id: "c1", note: "Die Unruhe nur andeuten." })],
      }),
    );
  });

  // Die Zählwerte waren nur sichtbar, wenn der Kapitelreiter offen war. Jetzt stehen sie in
  // der Statuszeile der Kontextleiste und folgen dem Text.
  it("zeigt Wörter, Zeichen und Normseiten in der Statuszeile", async () => {
    // TextWorkspace ist gesteuert: ohne einen Zustand, der onChange zurückspielt, könnte der
    // Test nur die Startwerte sehen und nicht, dass sie dem Text folgen.
    function Stateful() {
      const [value, setValue] = useState<Manuscript>(manuscript);
      return (
        <TextWorkspace
          manuscript={value}
          figures={figures}
          onChange={setValue}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="wide"
          binderOpen
          inspectorOpen
        />
      );
    }
    const view = render(
      <LanguageProvider>
        <Stateful />
      </LanguageProvider>,
    );
    const status = within(view.container.querySelector(".context-bar")!);
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("2");
    expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("10");
    expect(status.getByText("Normseiten").nextSibling).toHaveTextContent("0,0");
    const editor = view.container.querySelector(".cm-content") as HTMLElement;
    editor.textContent = "Ein Satz mehr im Kapitel";
    fireEvent.input(editor, { inputType: "insertText", data: "Ein Satz mehr im Kapitel" });
    await waitFor(() => expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("24"));
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("5");
  });

  // Umsortieren und Löschen laufen über onChange, nicht über die Editor-Handle -- also greifen
  // sie unter jsdom wirklich. Der Markdown-Export tut das nicht: er schreibt eine Datei über
  // download(). Dieser Test belegt darum nur, dass der Eintrag da ist, nicht dass er exportiert.
  it("führt Kapitelbefehle im Menü neben dem Titel", async () => {
    const twoChapters = {
      chapters: [
        ...manuscript.chapters,
        { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
      ],
    };
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript: twoChapters,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    fireEvent.click(within(view.container).getByRole("button", { name: "Kapitelaktionen" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Nach unten" })).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: "Nach oben" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Kapitel als Markdown" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Kapitel löschen" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Nach unten" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chapters: [expect.objectContaining({ id: "c2" }), expect.objectContaining({ id: "c1" })],
      }),
    );
  });

  it("löscht ein Kapitel erst nach der Bestätigung aus dem Menü heraus", async () => {
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    fireEvent.click(within(view.container).getByRole("button", { name: "Kapitelaktionen" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Kapitel löschen" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Kapitel löschen" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Kapitel löschen" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chapters: [] }));
  });

  it("ändert beim freien Nachschlagen keinen Manuskripttext ohne Ergebnisaktion", async () => {
    vi.spyOn(api, "languageStatus").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {},
    });
    vi.spyOn(api, "languageLookup").mockResolvedValue({
      ok: true,
      query: "Haus",
      language: "de-DE",
      mode: "dictionary",
      version: "test",
      results: [
        {
          lemma: "Haus",
          partOfSpeech: "Substantiv",
          meaning: "Gebäude",
          values: [],
          source: "wiktionary",
        },
      ],
    });
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole("tab", { name: "Wörterbuch" }));
    fireEvent.change(rendered.getByLabelText("Suchbegriff"), { target: { value: "Haus" } });
    fireEvent.submit(rendered.getByLabelText("Suchbegriff").closest("form")!);
    await rendered.findByText("Gebäude");
    expect(onChange).not.toHaveBeenCalled();
  });

  // Die Schreibhilfe zeigt genau einen Bereich: Nachschlagen, Prüfen oder Einfügen.
  it("zeigt immer nur einen Bereich der Schreibhilfe", async () => {
    vi.spyOn(api, "languageStatus").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {},
      grammar: {
        supported: true,
        unsupportedReason: "",
        available: true,
        installed: true,
        running: false,
        version: "6.6",
        javaVersion: 17,
        javaRequired: 17,
        externalConfigured: false,
        externalEnabled: false,
        download: { url: "", checksum: "", license: "LGPL" },
      },
    });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    // Nachschlagen ist der Startbereich: kein Grammatikknopf, keine Bausteine im Weg.
    expect(rendered.getByLabelText("Suchbegriff")).toBeTruthy();
    expect(rendered.queryByRole("button", { name: "Text prüfen" })).toBeNull();
    expect(rendered.queryByText("Sonderzeichen")).toBeNull();
    fireEvent.click(rendered.getByRole("tab", { name: "Prüfen" }));
    expect(rendered.getByRole("button", { name: "Text prüfen" })).toBeTruthy();
    expect(rendered.queryByLabelText("Suchbegriff")).toBeNull();
    fireEvent.click(rendered.getByRole("tab", { name: "Einfügen" }));
    expect(rendered.getByText("Sonderzeichen")).toBeTruthy();
    expect(rendered.queryByRole("button", { name: "Text prüfen" })).toBeNull();
  });

  // Die Lizenzpflicht bleibt, aber einmal je tatsächlich benutzter Quelle statt je Treffer.
  it("nennt jede benutzte Quelle genau einmal", async () => {
    vi.spyOn(api, "languageStatus").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {
        openthesaurus: {
          version: "1",
          url: "",
          checksum: "",
          license: "CC BY-SA 4.0",
          attribution: "OpenThesaurus.de",
        },
      },
    });
    vi.spyOn(api, "languageLookup").mockResolvedValue({
      ok: true,
      query: "gehen",
      language: "de-DE",
      mode: "synonyms",
      version: "test",
      results: [
        {
          lemma: "laufen",
          partOfSpeech: "Verb",
          meaning: "",
          values: ["laufen", "schreiten"],
          source: "openthesaurus",
        },
        {
          lemma: "klappen",
          partOfSpeech: "Verb",
          meaning: "",
          values: ["klappen"],
          source: "openthesaurus",
        },
      ],
    });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    fireEvent.change(rendered.getByLabelText("Suchbegriff"), { target: { value: "gehen" } });
    fireEvent.click(rendered.getByRole("tab", { name: "Synonyme" }));
    await rendered.findByText("schreiten");
    expect(rendered.getAllByText(/OpenThesaurus\.de · CC BY-SA 4\.0/)).toHaveLength(1);
  });

  // Das Projektwörterbuch ist Konfiguration, kein Werkzeug für den laufenden Satz.
  it("führt eigene Begriffe erst im Verwaltungs-Sheet zum Bearbeiten", async () => {
    const withTerms = { ...manuscript, words: [{ w: "Traumweberin", d: "" }] };
    const view = renderWorkspace({
      manuscript: withTerms,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole("tab", { name: "Einfügen" }));
    expect(rendered.getByRole("button", { name: "Traumweberin" })).toBeTruthy();
    expect(screen.queryByLabelText("Neuer Begriff")).toBeNull();
    fireEvent.click(rendered.getByRole("button", { name: "Verwalten" }));
    const sheet = within(screen.getByRole("dialog", { name: "Eigene Begriffe" }));
    expect(sheet.getByLabelText("Neuer Begriff")).toBeTruthy();
    expect(sheet.getByRole("button", { name: "Traumweberin entfernen" })).toBeTruthy();
  });

  it("ändert bei einer Grammatikprüfung keinen Text ohne bestätigte Ersetzung", async () => {
    vi.spyOn(api, "languageStatus").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {},
      grammar: {
        supported: true,
        unsupportedReason: "",
        available: true,
        installed: true,
        running: false,
        version: "6.6",
        javaVersion: 17,
        javaRequired: 17,
        externalConfigured: false,
        externalEnabled: false,
        download: { url: "", checksum: "", license: "LGPL" },
      },
    });
    vi.spyOn(api, "checkGrammar").mockResolvedValue({
      ok: true,
      language: "de-DE",
      issues: [
        {
          id: "i1",
          from: 0,
          to: 5,
          ruleId: "SPELL",
          category: "Rechtschreibung",
          message: "Möglicher Fehler",
          replacements: ["Hallo"],
        },
      ],
    });
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole("tab", { name: "Prüfen" }));
    fireEvent.click(rendered.getByRole("button", { name: "Text prüfen" }));
    await waitFor(() =>
      expect(api.checkGrammar).toHaveBeenCalledWith(
        "Hallo Welt",
        ["Testfigur"],
        expect.any(AbortSignal),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blendet die Grammatikprüfung aus, wenn die Ausgabe sie nicht unterstützt", async () => {
    // Store-Builds dürfen LanguageTool weder herunterladen noch die System-JVM
    // starten (backend/language/grammar/). Statt eines Knopfes, der scheitern
    // müsste, verschwindet der ganze Abschnitt.
    vi.spyOn(api, "languageStatus").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {},
      grammar: {
        supported: false,
        unsupportedReason: "Nicht in dieser Ausgabe enthalten.",
        available: false,
        installed: false,
        running: false,
        version: "6.6",
        javaVersion: null,
        javaRequired: 17,
        externalConfigured: false,
        externalEnabled: false,
        download: { url: "", checksum: "", license: "LGPL" },
      },
    });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      inspectorOpen: true,
    });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    expect(rendered.queryByRole("button", { name: "Text prüfen" })).toBeNull();
    // Ohne Grammatikprüfung entfällt der ganze Bereich, nicht nur sein Knopf.
    expect(rendered.queryByRole("tab", { name: "Prüfen" })).toBeNull();
    // Die übrigen Schreibhilfen bleiben erreichbar — nur die Grammatik entfällt.
    expect(rendered.getByRole("tab", { name: "Wörterbuch" })).toBeTruthy();
    expect(rendered.getByRole("tab", { name: "Einfügen" })).toBeTruthy();
  });

  it("setzt in der Buchfassung Auszeichnungen als <strong> und <em>", () => {
    // Die Bereiche zählen ab Kapitelanfang, die Absätze sind Ausschnitte daraus --
    // und die Szenentrennung bleibt eine Szenentrennung.
    const formatted = {
      chapters: [
        {
          id: "c1",
          title: "Prolog",
          body: "Hallo Welt\n\n*\n\nZweiter Absatz",
          note: "",
          marks: [
            { from: 6, to: 10, kind: "italic" as const },
            { from: 15, to: 22, kind: "bold" as const },
          ],
        },
      ],
    };
    const view = renderWorkspace({
      manuscript: formatted,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const book = view.container.querySelector(".print-document")!;
    expect(book.querySelector("em")).toHaveTextContent("Welt");
    expect(book.querySelector("strong")).toHaveTextContent("Zweiter");
    expect(book.querySelector(".scene-break")).toHaveTextContent("⁂");
    expect(book.querySelectorAll(".book-chapter p")[0]).toHaveTextContent("Hallo Welt");
  });

  it("bietet im Auswahlmenü Ausschneiden, Kopieren, Fett und Kursiv an", async () => {
    // Der Editor unterdrückt WebKits eigenes Kontextmenü, also trägt unseres die
    // gewöhnlichen Befehle mit. Einfügen fehlt bewusst: das kann nur der Browser.
    // jsdom hat kein Layout, also weiß der Editor ohne diesen Ersatz nicht, wo die
    // Markierung auf dem Bildschirm liegt -- und meldet dann gar keine.
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 40,
      top: 0,
      bottom: 16,
    });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const rendered = within(view.container);
    const editor = rendered.getByLabelText("Kapiteltext");
    EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!.dispatch({
      selection: EditorSelection.range(6, 10),
    });
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Fett/ })).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: /Kursiv/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Ausschneiden/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Kopieren/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Einfügen/ })).toBeNull();
  });

  it("meldet es, wenn die Zwischenablage den Text ablehnt", async () => {
    // WKWebView darf writeText verweigern. Vorher verschwand die Ablehnung stumm; jetzt
    // erfährt der Schreibende davon -- und Ausschneiden löscht die Stelle erst auf die
    // Zusage der Zwischenablage hin, statt einen Absatz zu entfernen, den niemand mehr
    // einfügen kann. Dass das Löschen ausbleibt, prüft dieser Test nicht: über die
    // Editor-Handle laufende Menübefehle greifen unter jsdom nicht.
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 40,
      top: 0,
      bottom: 16,
    });
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const editor = within(view.container).getByLabelText("Kapiteltext");
    EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!.dispatch({
      selection: EditorSelection.range(6, 10),
    });
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Ausschneiden/ })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Ausschneiden/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Zwischenablage/));
    expect(writeText).toHaveBeenCalledWith("Welt");
  });
});
