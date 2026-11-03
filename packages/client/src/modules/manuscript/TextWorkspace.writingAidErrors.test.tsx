import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationGatewayError, type WritingAssistanceStatus } from "../../platform";
import {
  figures,
  manuscript,
  renderWritingAid,
  requireValue,
  writingAssistanceApi,
} from "./TextWorkspace.testSupport";

afterEach(() => {
  vi.restoreAllMocks();
});

const grammar = {
  supported: true,
  unsupportedReason: "",
  available: true,
  installed: true,
  running: false,
  version: "6.6",
  javaVersion: 21,
  javaRequired: 17,
  externalConfigured: false,
  externalEnabled: false,
  download: { url: "", checksum: "", license: "LGPL" },
};

function status(overrides: Partial<WritingAssistanceStatus> = {}): WritingAssistanceStatus {
  return {
    ok: true,
    installed: true,
    coverage: "full",
    stale: false,
    version: "test",
    grammar,
    ...overrides,
  };
}

function render() {
  const view = renderWritingAid({
    manuscript,
    figures,
    onChange: vi.fn(),
    focus: false,
    onFocus: vi.fn(),
    inspectorOpen: true,
  });
  return within(view.container);
}

async function lookUp(rendered: ReturnType<typeof render>, word: string) {
  await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
  const field = await rendered.findByLabelText("Suchbegriff");
  fireEvent.change(field, { target: { value: word } });
  fireEvent.submit(requireValue(field.closest("form"), "Lookup form missing"));
}

function failure(code: string, params: Record<string, unknown> = {}) {
  return new ApplicationGatewayError("server text", code, { params });
}

describe("TextWorkspace writing aid failures", () => {
  it("says only the basic vocabulary is installed next to an empty result", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(status({ coverage: "core" }));
    vi.spyOn(writingAssistanceApi, "lookup").mockResolvedValue({
      ok: true,
      query: "Baum",
      locale: "de-DE",
      mode: "dictionary",
      version: "test",
      results: [],
    });
    const rendered = render();
    await lookUp(rendered, "Baum");
    await rendered.findByText("Keine Ergebnisse gefunden.");
    expect(rendered.getByText("Nur Grundwortschatz installiert")).toBeTruthy();
  });

  it("does not claim a basic vocabulary once the full data is installed", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(status({ coverage: "full" }));
    vi.spyOn(writingAssistanceApi, "lookup").mockResolvedValue({
      ok: true,
      query: "Baum",
      locale: "de-DE",
      mode: "dictionary",
      version: "test",
      results: [],
    });
    const rendered = render();
    await lookUp(rendered, "Baum");
    await rendered.findByText("Keine Ergebnisse gefunden.");
    expect(rendered.queryByText("Nur Grundwortschatz installiert")).toBeNull();
  });

  it("names the cause of a failed lookup instead of a generic sentence", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(status());
    vi.spyOn(writingAssistanceApi, "lookup").mockRejectedValue(
      failure("writing_assistance.not_installed"),
    );
    const rendered = render();
    await lookUp(rendered, "Baum");
    await rendered.findByText("Sprachdaten sind nicht installiert.");
    expect(rendered.queryByText("Die Anfrage konnte nicht ausgeführt werden.")).toBeNull();
  });

  it("names the cause of a failed grammar check", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(status());
    vi.spyOn(writingAssistanceApi, "checkGrammar").mockRejectedValue(
      failure("writing_assistance.grammar_start_failed"),
    );
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    fireEvent.click(rendered.getByRole("button", { name: "Text prüfen" }));
    await rendered.findByText("LanguageTool ist installiert, ließ sich aber nicht starten.");
    expect(rendered.queryByText("Die Grammatikprüfung konnte nicht ausgeführt werden.")).toBeNull();
  });

  it("offers to retry when the status cannot be loaded", async () => {
    const statusCall = vi
      .spyOn(writingAssistanceApi, "status")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(status());
    const rendered = render();
    await rendered.findByText("Der Zustand der Schreibhilfe konnte nicht geladen werden.");
    expect(rendered.queryByRole("button", { name: "Sprachdaten installieren" })).toBeNull();

    fireEvent.click(rendered.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(statusCall).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        rendered.queryByText("Der Zustand der Schreibhilfe konnte nicht geladen werden."),
      ).toBeNull(),
    );
    expect(rendered.getByLabelText("Suchbegriff")).toBeTruthy();
  });

  it("says Java is missing instead of offering a LanguageTool install that cannot work", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(
      status({
        grammar: { ...grammar, available: false, installed: false, javaVersion: null },
      }),
    );
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    await rendered.findByText("Für die lokale Grammatikprüfung wird Java 17 oder neuer benötigt.");
    expect(rendered.queryByRole("button", { name: "LanguageTool lokal installieren" })).toBeNull();
  });

  it("still offers the install when Java is present", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(
      status({ grammar: { ...grammar, available: false, installed: false, javaVersion: 21 } }),
    );
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    await rendered.findByRole("button", { name: "LanguageTool lokal installieren" });
  });
  it("checks through an enabled external server without Java or an install button", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(
      status({
        grammar: {
          ...grammar,
          available: true,
          installed: false,
          javaVersion: null,
          externalConfigured: true,
          externalEnabled: true,
        },
      }),
    );
    const check = vi
      .spyOn(writingAssistanceApi, "checkGrammar")
      .mockResolvedValue({ ok: true, locale: "de-DE", issues: [] });
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    fireEvent.click(rendered.getByRole("button", { name: "Text prüfen" }));
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(rendered.queryByRole("button", { name: "LanguageTool lokal installieren" })).toBeNull();
    expect(rendered.queryByText(/Java 17/)).toBeNull();
  });

  it("says a configured external server is not enabled instead of asking for Java", async () => {
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(
      status({
        grammar: {
          ...grammar,
          available: false,
          installed: false,
          javaVersion: null,
          externalConfigured: true,
          externalEnabled: false,
        },
      }),
    );
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    await rendered.findByText(
      "Ein externer Grammatikdienst ist eingetragen, aber nicht freigegeben.",
    );
    expect(rendered.queryByRole("button", { name: "LanguageTool lokal installieren" })).toBeNull();
    expect(rendered.queryByText(/Java 17/)).toBeNull();
  });

  it("offers no local install when an external server is configured but not enabled, even with Java", async () => {
    // Java present and the JAR missing would otherwise show the install
    // button; an install is pointless while check() goes to the external URL.
    vi.spyOn(writingAssistanceApi, "status").mockResolvedValue(
      status({
        grammar: {
          ...grammar,
          available: false,
          installed: false,
          javaVersion: 17,
          externalConfigured: true,
          externalEnabled: false,
        },
      }),
    );
    const rendered = render();
    await waitFor(() => expect(writingAssistanceApi.status).toHaveBeenCalled());
    fireEvent.click(await rendered.findByRole("tab", { name: "Prüfen" }));
    await rendered.findByText(
      "Ein externer Grammatikdienst ist eingetragen, aber nicht freigegeben.",
    );
    expect(rendered.queryByRole("button", { name: "LanguageTool lokal installieren" })).toBeNull();
  });
});
