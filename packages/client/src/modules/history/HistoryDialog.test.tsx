import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { HistoryDialog } from "./HistoryDialog";

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
  onClose = vi.fn(),
}: {
  diff?: string;
  onClose?: () => void;
} = {}) {
  const log = vi.spyOn(quiltorClient.application.history, "log").mockResolvedValue({
    ok: true,
    commits: [
      {
        hash: "commit-1",
        shortHash: "abc1234",
        date: "2026-08-23",
        subject: "Kapitel überarbeitet",
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
    onClose,
    ...render(
      <I18nProvider>
        <HistoryDialog flush={() => Promise.resolve()} onClose={onClose} />
      </I18nProvider>,
    ),
  };
}

describe("HistoryDialog", () => {
  it("selects history states and keeps comparison toggles semantic", async () => {
    const { loadDiff } = renderDialog();
    const states = screen.getByRole("navigation", { name: "Stände" });
    const workingState = within(states).getByRole("button", {
      name: /Seit letzter Sicherung.*Arbeitsstand/,
    });
    const commit = await within(states).findByRole("button", {
      name: /Kapitel überarbeitet.*abc1234.*2026-08-23/,
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

  it("keeps the close action accessible and delegates it to the sheet owner", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
