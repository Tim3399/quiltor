import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WritingAssistanceStatus } from "../../platform";
import { GrammarInspectorPanel } from "./GrammarInspectorPanel";
import type { Chapter, Manuscript, WritingIssue } from "./model";
import { TestProviders } from "./TextWorkspace.testSupport";

const current: Chapter = { id: "chapter", title: "Chapter", body: "Helo world", note: "" };
const manuscript: Manuscript = { chapters: [current], grammarMode: "manual" };
const issue: WritingIssue = {
  id: "issue",
  from: 0,
  to: 4,
  ruleId: "SPELL",
  category: "Spelling",
  message: "Possible typo",
  replacements: ["Hello"],
};
const status: WritingAssistanceStatus = {
  ok: true,
  installed: true,
  stale: false,
  version: "test",
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
};

describe("GrammarInspectorPanel", () => {
  afterEach(cleanup);
  it("separates issue selection from applying a replacement", () => {
    const onSelectIssue = vi.fn();
    const onApplyIssue = vi.fn();
    const common = {
      current,
      manuscript,
      status,
      issues: [issue],
      phase: "idle" as const,
      onCheck: vi.fn(),
      onInstall: vi.fn(),
      onSelectIssue,
      onApplyIssue,
      onGrammarMode: vi.fn(),
    };
    const view = render(
      <TestProviders>
        <GrammarInspectorPanel {...common} selectedIssue={null} />
      </TestProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Helo" }));
    expect(onSelectIssue).toHaveBeenCalledWith(issue);
    expect(onApplyIssue).not.toHaveBeenCalled();

    view.rerender(
      <TestProviders>
        <GrammarInspectorPanel {...common} selectedIssue={issue} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hello" }));
    expect(onApplyIssue).toHaveBeenCalledWith(issue, "Hello");
  });

  it.each([
    ["the status", { installable: false }, {}],
    ["the grammar status", {}, { installable: false }],
  ])("offers no LanguageTool install when %s is not installable", (_, top, inner) => {
    const missing: WritingAssistanceStatus = {
      ...status,
      ...top,
      grammar: { ...status.grammar!, available: false, installed: false, ...inner },
    };
    render(
      <TestProviders>
        <GrammarInspectorPanel
          current={current}
          manuscript={manuscript}
          status={missing}
          issues={[]}
          selectedIssue={null}
          phase="idle"
          onCheck={vi.fn()}
          onInstall={vi.fn()}
          onSelectIssue={vi.fn()}
          onApplyIssue={vi.fn()}
          onGrammarMode={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByText("Wird vom Betreiber eingerichtet")).toBeVisible();
    expect(screen.queryByRole("button", { name: /installieren/i })).not.toBeInTheDocument();
  });

  it("offers the LanguageTool install when the server is installable", () => {
    render(
      <TestProviders>
        <GrammarInspectorPanel
          current={current}
          manuscript={manuscript}
          status={{
            ...status,
            grammar: { ...status.grammar!, available: false, installed: false },
          }}
          issues={[]}
          selectedIssue={null}
          phase="idle"
          onCheck={vi.fn()}
          onInstall={vi.fn()}
          onSelectIssue={vi.fn()}
          onApplyIssue={vi.fn()}
          onGrammarMode={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.queryByText("Wird vom Betreiber eingerichtet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LanguageTool lokal installieren" })).toBeVisible();
  });

  it("shows the LanguageTool attribution for an enabled external server without a local install", () => {
    render(
      <TestProviders>
        <GrammarInspectorPanel
          current={current}
          manuscript={manuscript}
          status={{
            ...status,
            grammar: {
              ...status.grammar!,
              installed: false,
              externalConfigured: true,
              externalEnabled: true,
            },
          }}
          issues={[]}
          selectedIssue={null}
          phase="idle"
          onCheck={vi.fn()}
          onInstall={vi.fn()}
          onSelectIssue={vi.fn()}
          onApplyIssue={vi.fn()}
          onGrammarMode={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByText("Quellen und Lizenzen")).toBeVisible();
    expect(screen.getByText("LanguageTool 6.6 · LGPL")).toBeVisible();
  });

  it("exposes checking as progress rather than mutable placeholder copy", () => {
    render(
      <TestProviders>
        <GrammarInspectorPanel
          current={current}
          manuscript={manuscript}
          status={status}
          issues={[]}
          selectedIssue={null}
          phase="checking"
          onCheck={vi.fn()}
          onInstall={vi.fn()}
          onSelectIssue={vi.fn()}
          onApplyIssue={vi.fn()}
          onGrammarMode={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByRole("progressbar", { name: /Prüfe/ })).toBeVisible();
  });
});
