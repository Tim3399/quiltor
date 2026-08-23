import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import { figures, manuscript, renderWorkspace, TestProviders } from "./TextWorkspace.testSupport";

describe("TextWorkspace layout and panels", () => {
  it("bindet alle Toolbar-Gruppen an den gemeinsamen symmetrischen Action-Strip", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const actions = view.container.querySelector(".manuscript-toolbar-actions");

    expect(actions).toHaveClass("context-tools");
    expect(actions?.querySelectorAll(":scope > .tool-group").length).toBeGreaterThan(1);
  });

  it("macht den Fokusmodus explizit verlassbar", () => {
    renderWorkspace({ manuscript, figures, onChange: vi.fn(), focus: true, onFocus: vi.fn() });
    expect(screen.getByRole("button", { name: /Fokusmodus verlassen/ })).toBeVisible();
  });

  it("wechselt im Fokusmodus subtil zwischen Kapiteln", () => {
    const twoChapters = {
      chapters: [
        ...manuscript.chapters,
        { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
      ],
    };
    const view = renderWorkspace({
      manuscript: twoChapters,
      figures,
      onChange: vi.fn(),
      focus: true,
      onFocus: vi.fn(),
    });
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole("button", { name: "Kapitelauswahl öffnen" }));
    const picker = rendered.getByRole("complementary", { name: "Kapitelauswahl im Fokusmodus" });
    expect(within(picker).getByRole("button", { name: /Prolog/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(picker).getByRole("button", { name: /Aufbruch/ }));
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Aufbruch");
    expect(rendered.getByLabelText("Kapiteltext")).toHaveTextContent("Der Weg beginnt.");
  });

  it("blendet die Kapitelauswahl bei nur einem Kapitel aus", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: true,
      onFocus: vi.fn(),
    });
    expect(
      within(view.container).queryByRole("combobox", { name: "Kapitel im Fokusmodus auswählen" }),
    ).not.toBeInTheDocument();
  });

  it("ändert persistierbare Panelbreiten auch per Tastatur", () => {
    const onSidebarWidth = vi.fn();
    const onInspectorWidth = vi.fn();
    renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
      sidebarWidth: 246,
      inspectorWidth: 294,
      onSidebarWidth,
      onInspectorWidth,
    });
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Navigation breiter oder schmaler ziehen" }),
      { key: "ArrowRight" },
    );
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Schreibhilfe breiter oder schmaler ziehen" }),
      { key: "ArrowLeft" },
    );
    expect(onSidebarWidth).toHaveBeenCalledWith(256);
    expect(onInspectorWidth).toHaveBeenCalledWith(304);
  });

  it("lässt beide Spalten über die dezenten Rand-Schalter wieder aufmachen", () => {
    const onBinderOpen = vi.fn();
    const onInspectorOpen = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: false,
      inspectorOpen: false,
      onBinderOpen,
      onInspectorOpen,
    });
    const rendered = within(view.container);
    const chapters = rendered.getByRole("button", { name: "Kapitelnavigation öffnen" });
    expect(chapters).toHaveAttribute("aria-expanded", "false");
    expect(chapters).toHaveAttribute("aria-controls", "chapter-binder");
    fireEvent.click(chapters);
    expect(onBinderOpen).toHaveBeenCalledWith(true);
    const writingAid = rendered.getByRole("button", { name: "Schreibhilfe öffnen" });
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    expect(writingAid).toHaveAttribute("aria-controls", "writing-aid-inspector");
    expect(writingAid.querySelector(".lucide-panel-right")).not.toBeNull();
    expect(writingAid.querySelector(".lucide-pilcrow")).toBeNull();
    fireEvent.click(writingAid);
    expect(onInspectorOpen).toHaveBeenCalledWith(true);
  });

  it("zeigt die oberen Panel-Schalter auf Desktop und klappt beide Seiten wirklich um", () => {
    function StatefulPanels() {
      const [binderOpen, setBinderOpen] = useState(true);
      const [inspectorOpen, setInspectorOpen] = useState(true);
      return (
        <TextWorkspace
          manuscript={manuscript}
          figures={figures}
          onChange={vi.fn()}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="wide"
          binderOpen={binderOpen}
          inspectorOpen={inspectorOpen}
          onBinderOpen={setBinderOpen}
          onInspectorOpen={setInspectorOpen}
        />
      );
    }
    const view = render(
      <TestProviders>
        <StatefulPanels />
      </TestProviders>,
    );
    const rendered = within(view.container);
    const toolbar = within(view.container.querySelector(".context-bar")!);
    const chapters = toolbar.getByRole("button", { name: "Kapitel" });
    const writingAid = toolbar.getByRole("button", { name: "Schreibhilfe" });

    expect(chapters).toBeVisible();
    expect(writingAid).toBeVisible();
    expect(chapters).toHaveAttribute("aria-expanded", "true");
    expect(writingAid).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chapters);
    expect(rendered.queryByRole("complementary", { name: "Kapitel" })).toBeNull();
    expect(chapters).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chapters);
    expect(rendered.getByRole("complementary", { name: "Kapitel" })).toBeVisible();
    fireEvent.click(writingAid);
    expect(rendered.queryByRole("complementary", { name: "Schreibhilfe" })).toBeNull();
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(writingAid);
    expect(rendered.getByRole("complementary", { name: "Schreibhilfe" })).toBeVisible();
  });

  it("meldet die Schreibhilfe ohne Kapitel weder geöffnet noch als steuernd", () => {
    const onInspectorOpen = vi.fn();
    const view = renderWorkspace({
      manuscript: { chapters: [] },
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      inspectorOpen: true,
      onInspectorOpen,
    });
    const rendered = within(view.container);
    const writingAid = within(view.container.querySelector(".context-bar")!).getByRole("button", {
      name: "Schreibhilfe",
    });
    expect(writingAid).toBeDisabled();
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    expect(writingAid).toHaveAttribute("aria-pressed", "false");
    expect(writingAid).not.toHaveAttribute("aria-controls");
    expect(rendered.queryByRole("complementary", { name: "Schreibhilfe" })).toBeNull();
    fireEvent.click(writingAid);
    expect(onInspectorOpen).not.toHaveBeenCalled();
  });

  it("öffnet am Textrand und schließt außerhalb des Fokusmodus neben der Überschrift", () => {
    function StatefulPanels() {
      const [binderOpen, setBinderOpen] = useState(false);
      const [inspectorOpen, setInspectorOpen] = useState(false);
      return (
        <TextWorkspace
          manuscript={manuscript}
          figures={figures}
          onChange={vi.fn()}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="wide"
          binderOpen={binderOpen}
          inspectorOpen={inspectorOpen}
          onBinderOpen={setBinderOpen}
          onInspectorOpen={setInspectorOpen}
        />
      );
    }
    const view = render(
      <TestProviders>
        <StatefulPanels />
      </TestProviders>,
    );
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole("button", { name: "Kapitelnavigation öffnen" }));
    const binder = rendered.getByRole("complementary", { name: "Kapitel" });
    expect(binder).toHaveAttribute("id", "chapter-binder");
    expect(binder.querySelector(".panel-heading")).toHaveClass("panel-heading--binder");
    expect(rendered.queryByRole("button", { name: "Kapitelnavigation öffnen" })).toBeNull();
    const closeBinder = within(binder).getByRole("button", {
      name: "Kapitelnavigation schließen",
    });
    expect(closeBinder.closest(".panel-heading")).toHaveClass("panel-heading--binder");
    fireEvent.click(closeBinder);
    expect(rendered.queryByRole("complementary", { name: "Kapitel" })).toBeNull();
    expect(rendered.getByRole("button", { name: "Kapitelnavigation öffnen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(rendered.getByRole("button", { name: "Schreibhilfe öffnen" }));
    const aid = rendered.getByRole("complementary", { name: "Schreibhilfe" });
    expect(aid).toHaveAttribute("id", "writing-aid-inspector");
    expect(aid.querySelector(".panel-heading")).toHaveClass("panel-heading--inspector");
    expect(rendered.queryByRole("button", { name: "Schreibhilfe öffnen" })).toBeNull();
    const closeAid = within(aid).getByRole("button", { name: "Schreibhilfe schließen" });
    expect(closeAid.closest(".panel-heading")).toHaveClass("panel-heading--inspector");
    expect(closeAid.parentElement?.firstElementChild).toBe(closeAid);
    fireEvent.click(closeAid);
    expect(rendered.queryByRole("complementary", { name: "Schreibhilfe" })).toBeNull();
    expect(rendered.getByRole("button", { name: "Schreibhilfe öffnen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("nutzt im kompakten Layout weiterhin die Sheet-Schalter der Kontextleiste", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "compact",
      binderOpen: false,
      inspectorOpen: false,
    });
    const rendered = within(view.container);
    expect(rendered.queryByRole("button", { name: "Kapitelnavigation öffnen" })).toBeNull();
    expect(rendered.queryByRole("button", { name: "Schreibhilfe öffnen" })).toBeNull();
    const context = within(view.container.querySelector(".context-bar")!);
    expect(context.getByRole("button", { name: "Kapitel" })).toBeVisible();
    expect(context.getByRole("button", { name: "Schreibhilfe" })).toBeVisible();
  });

  it("öffnet und schließt beide kompakten Sheets über Toolbar und Panel-X", () => {
    function CompactPanels() {
      const [binderOpen, setBinderOpen] = useState(false);
      const [inspectorOpen, setInspectorOpen] = useState(false);
      return (
        <TextWorkspace
          manuscript={manuscript}
          figures={figures}
          onChange={vi.fn()}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="compact"
          binderOpen={binderOpen}
          inspectorOpen={inspectorOpen}
          onBinderOpen={setBinderOpen}
          onInspectorOpen={setInspectorOpen}
        />
      );
    }
    const view = render(
      <TestProviders>
        <CompactPanels />
      </TestProviders>,
    );
    const toolbar = within(view.container.querySelector(".context-bar")!);
    fireEvent.click(toolbar.getByRole("button", { name: "Kapitel" }));
    const chapters = screen.getByRole("dialog", { name: "Kapitel" });
    fireEvent.click(within(chapters).getByRole("button", { name: "Kapitelnavigation schließen" }));
    expect(screen.queryByRole("dialog", { name: "Kapitel" })).toBeNull();
    fireEvent.click(toolbar.getByRole("button", { name: "Schreibhilfe" }));
    const writingAid = screen.getByRole("dialog", { name: "Schreibhilfe" });
    fireEvent.click(within(writingAid).getByRole("button", { name: "Schreibhilfe schließen" }));
    expect(screen.queryByRole("dialog", { name: "Schreibhilfe" })).toBeNull();
  });

  it("behält im Fokusmodus die dezenten Aufklappschalter und keine Toolbar-Dopplung", () => {
    const twoChapters = {
      chapters: [
        ...manuscript.chapters,
        { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
      ],
    };
    const view = renderWorkspace({
      manuscript: twoChapters,
      figures,
      onChange: vi.fn(),
      focus: true,
      onFocus: vi.fn(),
      viewportMode: "wide",
    });
    const rendered = within(view.container);
    expect(view.container.querySelector(".panel-toggles")).toBeNull();
    const chapters = rendered.getByRole("button", { name: "Kapitelauswahl öffnen" });
    fireEvent.click(chapters);
    expect(chapters).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chapters);
    expect(chapters).toHaveAttribute("aria-expanded", "false");
    const writingAid = rendered.getByRole("button", { name: "Schreibhilfe öffnen" });
    expect(writingAid.querySelector(".lucide-panel-right")).not.toBeNull();
    fireEvent.click(writingAid);
    expect(writingAid).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(writingAid);
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
  });

  it("hält im rechten Panel nur noch die Schreibhilfe", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const aid = within(view.container.querySelector(".inspector")!);
    expect(view.container.querySelector(".panel-tabs")).toBeNull();
    expect(aid.getByRole("tab", { name: "Nachschlagen" })).toBeTruthy();
    expect(aid.queryByRole("tab", { name: "Kapitel" })).toBeNull();
    expect(aid.queryByLabelText("Kapitelnotiz")).toBeNull();
    expect(aid.queryByRole("button", { name: "Kapitel löschen" })).toBeNull();
    expect(aid.queryByRole("button", { name: "Nach oben" })).toBeNull();
  });
});
