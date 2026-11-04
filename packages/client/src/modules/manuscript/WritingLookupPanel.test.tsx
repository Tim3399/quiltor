import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./TextWorkspace.testSupport";
import { WritingLookupPanel } from "./WritingLookupPanel";
import type { WritingAssistanceStatus } from "../../platform";

describe("WritingLookupPanel", () => {
  afterEach(cleanup);
  it("names the part of speech in German and shows an unknown key as it stands", () => {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="Haus"
          status={{
            ok: true,
            installed: true,
            stale: false,
            version: "test",
            installedSources: [],
          }}
          results={[
            {
              lemma: "Haus",
              partOfSpeech: "noun",
              meaning: "Gebäude",
              values: [],
              source: "wiktionary",
            },
            {
              lemma: "hausen",
              partOfSpeech: "novel-pos",
              meaning: "wohnen",
              values: [],
              source: "wiktionary",
            },
          ]}
          phase="idle"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={vi.fn()}
          onLocale={vi.fn()}
          onInstallData={vi.fn()}
          onApplyValue={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByText("Substantiv")).toHaveClass("writing-result__part-of-speech");
    expect(screen.queryByText("noun")).toBeNull();
    expect(screen.getByText("novel-pos")).toHaveClass("writing-result__part-of-speech");
  });

  it("keeps source selection, lookup results and apply actions inside the lookup panel", () => {
    const onChooseTool = vi.fn();
    const onApplyValue = vi.fn();
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={{
            ok: true,
            installed: true,
            stale: false,
            version: "test",
            installedSources: [
              { name: "Dictionary source", url: "", license: "CC", licenseUrl: "" },
            ],
          }}
          results={[
            {
              lemma: "gehen",
              partOfSpeech: "Verb",
              meaning: "sich bewegen",
              values: ["laufen"],
              source: "dictionary",
            },
          ]}
          phase="idle"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={onChooseTool}
          onLocale={vi.fn()}
          onInstallData={vi.fn()}
          onApplyValue={onApplyValue}
        />
      </TestProviders>,
    );

    const sourceTabs = screen.getByRole("tablist", { name: "Nachschlagewerk" });
    expect(sourceTabs.parentElement).toHaveClass(
      "scroll-area",
      "writing-tab-scroll",
      "writing-tool-tabs__scroll",
    );
    expect(sourceTabs.parentElement).toHaveAttribute("data-scrollbar", "thin");
    const synonymTab = screen.getByRole("tab", { name: "Synonyme" });
    expect(synonymTab).toHaveClass("writing-tool-tab");
    fireEvent.click(synonymTab);
    expect(onChooseTool).toHaveBeenCalledWith("synonyms");
    expect(screen.getByText("Dictionary source", { exact: false })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "laufen" }));
    expect(onApplyValue).toHaveBeenCalledWith("laufen");
  });

  it.each([
    [false, "Wird vom Betreiber eingerichtet", "Sprachdaten installieren"],
    [true, "Sprachdaten installieren", "Wird vom Betreiber eingerichtet"],
  ])("with installable %s shows %s and not %s", (installable, shown, hidden) => {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={{
            ok: true,
            installed: false,
            installable,
            stale: false,
            version: null,
          }}
          results={[]}
          phase="idle"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={vi.fn()}
          onLocale={vi.fn()}
          onInstallData={vi.fn()}
          onApplyValue={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByText(shown)).toBeVisible();
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  });

  function renderMissingData(data: WritingAssistanceStatus["data"]) {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={{
            ok: true,
            installed: false,
            installable: true,
            stale: false,
            version: null,
            data,
          }}
          results={[]}
          phase="idle"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={vi.fn()}
          onLocale={vi.fn()}
          onInstallData={vi.fn()}
          onApplyValue={vi.fn()}
        />
      </TestProviders>,
    );
  }

  it("says the language data is missing, without an error, when none is installed", () => {
    renderMissingData({ available: true, reason: null, version: "2026.11.03", bytes: 1000 });

    expect(screen.getByText("Sprachdaten sind nicht installiert.")).toBeVisible();
    expect(
      screen.queryByText("Die Anfrage konnte nicht ausgeführt werden."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sprachdaten installieren" })).toBeVisible();
  });

  it("offers no install that could only fail while no data release is published", () => {
    renderMissingData({ available: false, reason: "not_published", version: null, bytes: null });

    expect(screen.getByText("Sprachdaten sind nicht installiert.")).toBeVisible();
    expect(screen.getByText("Die Sprachdaten folgen mit einem späteren Update.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sprachdaten installieren" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  function renderPanel(
    status: WritingAssistanceStatus,
    onInstallData = vi.fn(),
    withResult = false,
  ) {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={status}
          results={
            withResult
              ? [
                  {
                    lemma: "gehen",
                    partOfSpeech: "Verb",
                    meaning: "sich bewegen",
                    values: ["laufen"],
                    source: "dictionary",
                  },
                ]
              : []
          }
          phase="idle"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={vi.fn()}
          onLocale={vi.fn()}
          onInstallData={onInstallData}
          onApplyValue={vi.fn()}
        />
      </TestProviders>,
    );
  }

  it("names the download size before anything is fetched", () => {
    renderMissingData({ available: true, reason: null, version: "2026.11.03", bytes: 12_340_000 });

    expect(screen.getByText("Download: 12,3 MB")).toBeVisible();
  });

  it("offers an update instead of a first install when the data is stale", () => {
    const onInstallData = vi.fn();
    renderPanel(
      {
        ok: true,
        installed: false,
        stale: true,
        version: "old",
        data: { available: true, reason: null, version: "new", bytes: 5_000_000 },
      },
      onInstallData,
    );

    expect(screen.getByText("Die Sprachdaten sind veraltet.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sprachdaten installieren" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sprachdaten aktualisieren" }));
    expect(onInstallData).toHaveBeenCalledTimes(1);
  });

  it("keeps stale data behind the calm note while no release is published", () => {
    renderPanel({
      ok: true,
      installed: false,
      stale: true,
      version: "old",
      data: { available: false, reason: "not_published", version: null, bytes: null },
    });

    expect(screen.getByText("Die Sprachdaten folgen mit einem späteren Update.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sprachdaten aktualisieren" }),
    ).not.toBeInTheDocument();
  });

  it("offers the update next to the results of an installed but outdated dictionary", () => {
    renderPanel(
      {
        ok: true,
        installed: true,
        stale: true,
        version: "x",
        data: { available: true, reason: null, version: "y", bytes: 1_000_000 },
      },
      vi.fn(),
      true,
    );

    expect(screen.getByRole("button", { name: "laufen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sprachdaten aktualisieren" })).toBeVisible();
  });

  it("links the recorded sources and licenses and marks the data as edited", () => {
    renderPanel(
      {
        ok: true,
        installed: true,
        stale: false,
        version: "x",
        installedSources: [
          {
            name: "Wiktionary",
            url: "https://de.wiktionary.org/",
            license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
          { name: "Offline-Quelle", url: "javascript:alert(1)", license: "", licenseUrl: "" },
        ],
      },
      vi.fn(),
      true,
    );

    expect(screen.getByRole("link", { name: "Wiktionary" })).toHaveAttribute(
      "href",
      "https://de.wiktionary.org/",
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    expect(screen.getByText("Offline-Quelle")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.getByText("Die Daten wurden für Quiltor ausgewählt, umgerechnet und bearbeitet."),
    ).toBeVisible();
  });

  it("names no license footer for installed data that records no sources", () => {
    renderPanel({ ok: true, installed: true, stale: false, version: "x" }, vi.fn(), true);

    expect(screen.getByRole("button", { name: "laufen" })).toBeVisible();
    expect(screen.queryByText("Quellen und Lizenzen")).not.toBeInTheDocument();
    expect(screen.queryByText(/GFDL|dumps\.wikimedia/)).not.toBeInTheDocument();
  });

  it("shows no license footer while nothing is installed", () => {
    renderMissingData({ available: false, reason: "not_published", version: null, bytes: null });

    expect(screen.queryByText("Quellen und Lizenzen")).not.toBeInTheDocument();
  });

  it("uses the shared progress contract while a request is running", () => {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={{ ok: true, installed: true, stale: false, version: "test" }}
          results={[]}
          phase="loading"
          replaceTarget={false}
          onWritingQuery={vi.fn()}
          onRunLookup={vi.fn()}
          onChooseTool={vi.fn()}
          onLocale={vi.fn()}
          onInstallData={vi.fn()}
          onApplyValue={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByRole("progressbar", { name: /Suche/ })).toBeVisible();
  });
});
