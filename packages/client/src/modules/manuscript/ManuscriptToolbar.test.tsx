import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ManuscriptToolbar } from "./ManuscriptToolbar";

afterEach(cleanup);

it("links manuscript export actions and restores focus after selection", async () => {
  const onExport = vi.fn();
  const { container } = render(
    <I18nProvider>
      <ManuscriptToolbar
        focus={false}
        binderOpen={false}
        inspectorOpen={false}
        historyOpen={false}
        canUndo={false}
        canRedo={false}
        pdfState="idle"
        preview={false}
        onAddChapter={vi.fn()}
        onBinderOpen={vi.fn()}
        onInspectorOpen={vi.fn()}
        onFocus={vi.fn()}
        onHistoryOpen={vi.fn()}
        onExport={onExport}
        onPrint={vi.fn()}
        onPreview={vi.fn()}
        onInsertSceneBreak={vi.fn()}
      />
    </I18nProvider>,
  );

  const trigger = screen.getByRole("button", { name: "Exportieren" });
  const responsiveActions = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '.manuscript-toolbar .ui-toolbar-button[data-label-mode="responsive"]:not([data-workspace-action="create"])',
    ),
  ];
  expect(responsiveActions.length).toBeGreaterThan(0);
  for (const action of responsiveActions)
    expect(action).toHaveAttribute("data-collapse-at", "medium");
  const createChapter = screen.getByRole("button", { name: "Neues Kapitel" });
  expect(createChapter).toHaveClass(
    "workspace-toolbar__create-button",
    "ui-toolbar-button",
    "ui-button--primary",
    "ui-button--regular",
  );
  expect(createChapter).toHaveAttribute("data-workspace-action", "create");
  expect(createChapter).toHaveAttribute("data-appearance", "primary");
  expect(createChapter).toHaveAttribute("data-size", "regular");
  expect(createChapter).toHaveAttribute("data-label-mode", "responsive");
  expect(createChapter).toHaveAttribute("data-collapse-at", "compact");
  expect(createChapter.querySelector(".ui-button__icon svg")).not.toBeNull();
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

it("exposes print preview and scene-break actions", () => {
  const onPreview = vi.fn();
  const onInsertSceneBreak = vi.fn();
  render(
    <I18nProvider>
      <ManuscriptToolbar
        current={{ id: "c1", title: "Prolog", body: "", note: "" }}
        focus={false}
        binderOpen={false}
        inspectorOpen={false}
        historyOpen={false}
        canUndo={false}
        canRedo={false}
        pdfState="idle"
        preview={false}
        onAddChapter={vi.fn()}
        onBinderOpen={vi.fn()}
        onInspectorOpen={vi.fn()}
        onFocus={vi.fn()}
        onHistoryOpen={vi.fn()}
        onExport={vi.fn()}
        onPrint={vi.fn()}
        onPreview={onPreview}
        onInsertSceneBreak={onInsertSceneBreak}
      />
    </I18nProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Druckansicht" }));
  fireEvent.click(screen.getByRole("button", { name: "Szenenwechsel einfügen" }));
  expect(onPreview).toHaveBeenCalledWith(true);
  expect(onInsertSceneBreak).toHaveBeenCalledOnce();
});
