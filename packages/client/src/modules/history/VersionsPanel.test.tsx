import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { VersionsPanel } from "./VersionsPanel";

const chapterDiff = [
  "diff --git a/manuscripts/01 - Anfang.md b/manuscripts/01 - Anfang.md",
  "index 1111111..2222222 100644",
  "--- a/manuscripts/01 - Anfang.md",
  "+++ b/manuscripts/01 - Anfang.md",
  "@@ -1 +1 @@",
  "-Alt",
  "+Neu",
].join("\n");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog({
  diff = "",
  subject = "Kapitel überarbeitet",
  flush = () => Promise.resolve(),
}: {
  diff?: string;
  subject?: string;
  flush?: () => Promise<void>;
} = {}) {
  const log = vi.spyOn(quiltorClient.application.history, "log").mockResolvedValue({
    ok: true,
    commits: [
      {
        hash: "commit-1",
        shortHash: "abc1234",
        date: "2026-08-23T10:00:00",
        subject,
      },
    ],
  });
  const loadDiff = vi.spyOn(quiltorClient.application.history, "diff").mockResolvedValue({
    ok: true,
    diff,
    newFiles: [],
    mode: "word",
  });

  return {
    loadDiff,
    log,
    ...render(
      <I18nProvider>
        <VersionsPanel flush={flush} onDocumentsReplaced={vi.fn()} />
      </I18nProvider>,
    ),
  };
}

describe("VersionsPanel", () => {
  it("explains at the top what a version is", () => {
    renderDialog();
    const intro = screen.getByText(
      "Eine Version hältst du selbst fest, mit einer kurzen Notiz. Du kannst sie jederzeit vergleichen oder wiederherstellen.",
    );
    expect(intro).toBeVisible();
    expect(intro).toHaveClass("muted");
  });
  it("shortens a long version name with an ellipsis, keeps the full name as title and in the text", async () => {
    const subject = "Sehr lange Notiz ".repeat(12).trim();
    renderDialog({ subject });
    const states = screen.getByRole("navigation", { name: "Stände" });
    const name = await within(states).findByText(new RegExp(`${subject}$`));
    expect(name).toHaveClass("history-state-name");
    expect(name).toHaveAttribute("title", name.textContent ?? "");
    expect(name.textContent).toContain(subject);
  });
  it("shows a failed flush without reading an outdated history or diff", async () => {
    const { log, loadDiff } = renderDialog({
      flush: vi.fn().mockRejectedValue(new Error("Draft could not be saved")),
    });
    expect(await screen.findByText("Draft could not be saved")).toBeVisible();
    expect(log).not.toHaveBeenCalled();
    expect(loadDiff).not.toHaveBeenCalled();
  });
  it("selects history states and keeps comparison toggles semantic", async () => {
    const { loadDiff } = renderDialog();
    const states = screen.getByRole("navigation", { name: "Stände" });
    const workingState = within(states).getByRole("button", {
      name: /Aktueller Stand.*Änderungen seit der letzten Version/,
    });
    const commit = await within(states).findByRole("button", {
      name: /23\.08\.2026, 10:00 · Kapitel überarbeitet.*abc1234/,
    });

    expect(workingState).toHaveAttribute("aria-pressed", "true");
    expect(commit).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(commit);
    expect(commit).toHaveAttribute("aria-pressed", "true");
    expect(workingState).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(loadDiff).toHaveBeenCalledWith("commit-1", true, false));

    const wordMode = screen.getByRole("button", { name: "Wortweise" });
    expect(wordMode).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(wordMode);
    const lineMode = screen.getByRole("button", { name: "Zeilenweise" });
    expect(lineMode).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(loadDiff).toHaveBeenCalledWith("commit-1", false, false));

    const textOnly = screen.getByRole("button", { name: "Nur Text" });
    expect(textOnly).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(textOnly);
    const allFiles = screen.getByRole("button", { name: "Alle Dateien" });
    expect(allFiles).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(loadDiff).toHaveBeenCalledWith("commit-1", false, true));
  });

  it("expands and collapses a diff segment", async () => {
    renderDialog({ diff: chapterDiff });

    const summary = await screen.findByRole("button", { name: /Anfang/ });
    await waitFor(() => expect(summary).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("heading", { name: "Kapitel · Anfang" })).toBeVisible();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Kapitel · Anfang" })).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Kapitel · Anfang" })).toBeVisible();
  });

  it("drops the previous diff while the next comparison loads", async () => {
    const { loadDiff } = renderDialog({ diff: chapterDiff });
    await screen.findByRole("button", { name: /Anfang/ });

    let finish!: (
      value: Awaited<ReturnType<typeof quiltorClient.application.history.diff>>,
    ) => void;
    loadDiff.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wortweise" }));
    await waitFor(() => expect(loadDiff).toHaveBeenLastCalledWith("WORK", false, false));
    expect(screen.queryByRole("button", { name: /Anfang/ })).not.toBeInTheDocument();

    await act(async () => finish({ ok: true, diff: chapterDiff, newFiles: [], mode: "line" }));
    expect(await screen.findByRole("button", { name: /Anfang/ })).toBeVisible();
  });

  it("expands the segments of every newly loaded diff again", async () => {
    renderDialog({ diff: chapterDiff });
    const summary = await screen.findByRole("button", { name: /Anfang/ });
    await waitFor(() => expect(summary).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Wortweise" }));
    const reloaded = await screen.findByRole("button", { name: /Anfang/ });
    await waitFor(() => expect(reloaded).toHaveAttribute("aria-expanded", "true"));
  });
});
