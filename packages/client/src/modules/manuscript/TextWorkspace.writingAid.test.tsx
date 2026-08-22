import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  figures,
  manuscript,
  renderWorkspace,
  writingAssistanceApi,
} from "./TextWorkspace.testSupport";

afterEach(() => vi.restoreAllMocks());

describe("TextWorkspace writing aid", () => {
  it("ändert beim freien Nachschlagen keinen Manuskripttext ohne Ergebnisaktion", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue({
      ok: true,
      installed: true,
      stale: false,
      version: "test",
      sources: {},
    });
    vi.spyOn(writingAssistanceApi, "lookup").mockResolvedValue({
      ok: true,
      query: "Haus",
      locale: "de-DE",
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
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole("tab", { name: "Wörterbuch" }));
    fireEvent.change(rendered.getByLabelText("Suchbegriff"), { target: { value: "Haus" } });
    fireEvent.submit(rendered.getByLabelText("Suchbegriff").closest("form")!);
    await rendered.findByText("Gebäude");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zeigt immer nur einen Bereich der Schreibhilfe", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue({
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
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
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

  it("nennt jede benutzte Quelle genau einmal", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue({
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
    vi.spyOn(writingAssistanceApi, "lookup").mockResolvedValue({
      ok: true,
      query: "gehen",
      locale: "de-DE",
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
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.change(rendered.getByLabelText("Suchbegriff"), { target: { value: "gehen" } });
    fireEvent.click(rendered.getByRole("tab", { name: "Synonyme" }));
    await rendered.findByText("schreiten");
    expect(rendered.getAllByText(/OpenThesaurus\.de · CC BY-SA 4\.0/)).toHaveLength(1);
  });

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
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue({
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
    vi.spyOn(writingAssistanceApi, "checkGrammar").mockResolvedValue({
      ok: true,
      locale: "de-DE",
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
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole("tab", { name: "Prüfen" }));
    fireEvent.click(rendered.getByRole("button", { name: "Text prüfen" }));
    await waitFor(() =>
      expect(writingAssistanceApi.checkGrammar).toHaveBeenCalledWith(
        "Hallo Welt",
        ["Testfigur"],
        expect.any(AbortSignal),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blendet die Grammatikprüfung aus, wenn die Ausgabe sie nicht unterstützt", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue({
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
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    expect(rendered.queryByRole("button", { name: "Text prüfen" })).toBeNull();
    expect(rendered.queryByRole("tab", { name: "Prüfen" })).toBeNull();
    expect(rendered.getByRole("tab", { name: "Wörterbuch" })).toBeTruthy();
    expect(rendered.getByRole("tab", { name: "Einfügen" })).toBeTruthy();
  });
});
