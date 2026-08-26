import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./TextWorkspace.testSupport";
import { WritingLookupPanel } from "./WritingLookupPanel";

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
