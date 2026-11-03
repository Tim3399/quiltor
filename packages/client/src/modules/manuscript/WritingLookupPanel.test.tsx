import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./TextWorkspace.testSupport";
import { WritingLookupPanel } from "./WritingLookupPanel";
import type { WritingAssistanceStatus } from "../../platform";

describe("WritingLookupPanel", () => {
  afterEach(cleanup);
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
            sources: {
              dictionary: {
                version: "1",
                url: "",
                checksum: "",
                license: "CC",
                attribution: "Dictionary source",
              },
            },
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
          lookupSources={["dictionary"]}
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
    expect(screen.getByText("Dictionary source · CC")).toBeVisible();
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
            sources: {},
          }}
          results={[]}
          phase="idle"
          replaceTarget={false}
          lookupSources={["dictionary"]}
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
            sources: {},
          }}
          results={[]}
          phase="idle"
          replaceTarget={false}
          lookupSources={["dictionary"]}
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

  it("uses the shared progress contract while a request is running", () => {
    render(
      <TestProviders>
        <WritingLookupPanel
          selectionTool="lookup"
          writingLocale="de-DE"
          writingQuery="gehen"
          status={{ ok: true, installed: true, stale: false, version: "test", sources: {} }}
          results={[]}
          phase="loading"
          replaceTarget={false}
          lookupSources={[]}
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
