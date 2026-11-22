import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// T-329: the generic field rule made the box taller and resizable, and the field's margin
// pushed the send button below its edge and cut the note off. jsdom does no layout, so the
// cascade is checked on the rules themselves; the product suite measures the geometry.
describe("composer field geometry", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  const rule = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("hangs the composer class on the field that wraps the textarea", () => {
    render(<ComposerHarness />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveClass("assistant-composer-input");
    expect(input.parentElement).toHaveClass("ui-field", "assistant-composer-field");
  });

  it("outranks the generic field rule and drops the field's margin", () => {
    const composer = read("packages/client/src/modules/assistant/AssistantComposer.css");
    const field = read("packages/client/src/design/primitives/Field/Field.css");
    // .ui-field > textarea is (0,1,1); two classes are (0,2,0) and win regardless of order.
    expect(rule(field, ".ui-field > textarea")).toMatch(/min-height:/);
    const input = rule(composer, ".assistant-composer-field > .assistant-composer-input");
    expect(input).toMatch(/min-height:\s*0;/);
    expect(input).toMatch(/resize:\s*none;/);
    expect(rule(composer, ".assistant-composer-field")).toMatch(/margin:\s*0;/);
    expect(rule(composer, ".assistant-drawer > footer")).not.toMatch(
      /grid-template-columns:[^;]*\d+px/,
    );
  });
});
