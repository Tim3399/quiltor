import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ManuscriptToolbar } from "./ManuscriptToolbar";

afterEach(cleanup);

it("links manuscript export actions and restores focus after selection", async () => {
  const onExport = vi.fn();
  const onExportDocx = vi.fn();
  const onExportEpub = vi.fn();
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
        onExportDocx={onExportDocx}
        onExportEpub={onExportEpub}
        onPrint={vi.fn()}
        onPreview={vi.fn()}
        onInsertSceneBreak={vi.fn()}
      />
    </I18nProvider>,
  );

  const trigger = screen.getByRole("button", { name: "Weitere Aktionen" });
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

  const overflowMenu = await screen.findByRole("menu", { name: "Weitere Aktionen" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", overflowMenu.id);
  const menu = overflowMenu;
  expect(
    within(menu).getByRole("menuitem", { name: "Manuskript als Markdown" }),
  ).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "DOCX fürs Lektorat" })).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "DOCX als Normseite" })).toBeInTheDocument();
  const epubItem = within(menu).getByRole("menuitem", { name: "EPUB für E-Reader" });
  expect(epubItem).toBeInTheDocument();
  fireEvent.click(epubItem);
  expect(onExportEpub).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  fireEvent.click(trigger);
  const reopenedMenu = await screen.findByRole("menu", { name: "Weitere Aktionen" });
  const reopenedExportItem = within(reopenedMenu).getByRole("menuitem", {
    name: "Manuskript als Markdown",
  });
  expect(reopenedExportItem.querySelector(".ui-menu__label")).toHaveTextContent(
    "Manuskript als Markdown",
  );
  fireEvent.click(reopenedExportItem);

  expect(onExport).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("keeps print preview and scene break one click away in the overflow menu", () => {
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
        onExportDocx={vi.fn()}
        onExportEpub={vi.fn()}
        onPrint={vi.fn()}
        onPreview={onPreview}
        onInsertSceneBreak={onInsertSceneBreak}
      />
    </I18nProvider>,
  );

  expect(screen.queryByRole("button", { name: "Druckansicht" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Druckansicht" }));
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Szenenwechsel einfügen" }));
  expect(onPreview).toHaveBeenCalledWith(true);
  expect(onInsertSceneBreak).toHaveBeenCalledOnce();
});

it("offers the versions only where the world keeps them", () => {
  const toolbar = (versionsAvailable: boolean) => (
    <I18nProvider>
      <ManuscriptToolbar
        current={{ id: "c1", title: "Prolog", body: "", note: "" }}
        focus={false}
        binderOpen={false}
        inspectorOpen={false}
        historyOpen={false}
        versionsAvailable={versionsAvailable}
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
        onExportDocx={vi.fn()}
        onExportEpub={vi.fn()}
        onPrint={vi.fn()}
        onPreview={vi.fn()}
        onInsertSceneBreak={vi.fn()}
      />
    </I18nProvider>
  );
  const { rerender } = render(toolbar(true));
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  expect(screen.getByRole("menuitem", { name: "Versionen" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  rerender(toolbar(false));
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  expect(screen.queryByRole("menuitem", { name: "Versionen" })).toBeNull();
});
