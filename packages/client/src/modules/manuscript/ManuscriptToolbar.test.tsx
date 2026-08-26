import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ManuscriptToolbar } from "./ManuscriptToolbar";

afterEach(cleanup);

it("links manuscript export actions and restores focus after selection", async () => {
  const onExport = vi.fn();
  render(
    <I18nProvider>
      <ManuscriptToolbar
        totalWords={1200}
        focus={false}
        binderOpen={false}
        inspectorOpen={false}
        historyOpen={false}
        canUndo={false}
        canRedo={false}
        pdfState="idle"
        onAddChapter={vi.fn()}
        onBinderOpen={vi.fn()}
        onInspectorOpen={vi.fn()}
        onFocus={vi.fn()}
        onHistoryOpen={vi.fn()}
        onExport={onExport}
        onPrint={vi.fn()}
      />
    </I18nProvider>,
  );

  const trigger = screen.getByRole("button", { name: "Exportieren" });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });

  const menu = await screen.findByRole("menu");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", menu.id);
  const exportItem = within(menu).getByRole("menuitem", { name: "Manuskript" });
  expect(exportItem.querySelector(".ui-menu__label")).toHaveTextContent("Manuskript");
  fireEvent.click(exportItem);

  expect(onExport).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
