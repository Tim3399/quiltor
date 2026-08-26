import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Chapter } from "../manuscript";
import { AssistantComposer } from "./AssistantComposer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chapters: Chapter[] = Array.from({ length: 24 }, (_, index) => ({
  id: `chapter-${index}`,
  title: `Kapitel ${index + 1}`,
  body: "",
  note: "",
}));

function ComposerHarness() {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <I18nProvider>
      <AssistantComposer
        chapters={chapters}
        forcedChapterIds={selected}
        onForcedChapterIdsChange={setSelected}
        chapterPickerRef={trigger}
        chapterPickerOpen={open}
        onChapterPickerOpenChange={setOpen}
        draft=""
        onDraftChange={() => undefined}
        sending={false}
        unavailable={false}
        onSend={() => undefined}
        onCancel={() => undefined}
      />
    </I18nProvider>
  );
}

describe("AssistantComposer chapter picker", () => {
  it("portals a scrollable long chapter list and restores trigger focus after outside input", async () => {
    render(<ComposerHarness />);
    const trigger = screen.getByRole("button", { name: "Kontext: gesamte Welt" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Kapitel einzeln auswählen" });
    const list = within(dialog).getByRole("group", { name: "Kapitel einzeln auswählen" });
    expect(list).toHaveClass("scroll-area", "assistant-chapter-picker-list");
    expect(list).toHaveAttribute("data-axis", "y");
    expect(within(list).getAllByRole("checkbox")).toHaveLength(24);
    await waitFor(() =>
      expect(within(list).getByRole("checkbox", { name: "1. Kapitel 1" })).toHaveFocus(),
    );

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses the compact modal sheet and closes it with Escape", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<ComposerHarness />);
    const trigger = screen.getByRole("button", { name: "Kontext: gesamte Welt" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Kapitel einzeln auswählen" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(within(dialog).getByRole("checkbox", { name: "1. Kapitel 1" })).toHaveFocus(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
