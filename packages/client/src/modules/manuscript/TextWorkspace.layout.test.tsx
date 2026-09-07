import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import { figures, manuscript, renderWorkspace, TestProviders } from "./TextWorkspace.testSupport";

describe("TextWorkspace layout and panels", () => {
  it("delegates chapter and editor scrolling to semantic ScrollArea owners", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const chapterList = view.container.querySelector(".chapter-list");
    const editor = view.container.querySelector(".editor-scroll");

    expect(chapterList?.tagName).toBe("UL");
    expect(chapterList).toHaveClass("scroll-area", "chapter-list", "binder-tree");
    expect(chapterList).toHaveAttribute("data-axis", "y");
    expect(chapterList).toHaveAttribute("data-gutter", "stable");
    expect(chapterList).toHaveAttribute("data-overscroll", "auto");
    expect(chapterList).toHaveAttribute("data-scrollbar", "thin");
    expect(chapterList).toHaveAttribute("data-surface", "panel");

    expect(editor?.tagName).toBe("ARTICLE");
    expect(editor).toHaveClass("scroll-area", "editor-scroll");
    expect(editor).toHaveAttribute("data-axis", "y");
    expect(editor).toHaveAttribute("data-gutter", "both-edges");
    expect(editor).toHaveAttribute("data-overscroll", "contain");
    expect(editor).toHaveAttribute("data-scrollbar", "thin");
    expect(editor).toHaveAttribute("data-surface", "canvas");

    const root = join(process.cwd(), "packages/client/src/modules/manuscript");
    const workspaceCss = readFileSync(join(root, "WorkspaceLayout.css"), "utf8");
    const chapterCss = readFileSync(join(root, "ChapterBinder.css"), "utf8");
    const editorCss = readFileSync(join(root, "EditorSurface.css"), "utf8");
    const turnCss = readFileSync(join(root, "ChapterTurnAffordance.css"), "utf8");
    expect(workspaceCss).not.toMatch(
      /scrollbar-(?:color|width|gutter)|--scrollbar-surface|::-webkit-scrollbar/,
    );
    expect(chapterCss).not.toMatch(/\.chapter-list\s*\{[^}]*overflow/s);
    expect(editorCss).not.toMatch(
      /\.editor-scroll\s*\{[^}]*(?:overflow|scrollbar-gutter|background:\s*var\(--paper\))/s,
    );
    expect(workspaceCss).toMatch(
      /\.text-layout\.has-balanced-editor \.editor-page\s*\{[^}]*left:\s*var\(--editor-balance-offset\);/s,
    );
    expect(workspaceCss).not.toMatch(
      /\.text-layout\.has-balanced-editor \.editor-page\s*\{[^}]*transform:/s,
    );
    expect(workspaceCss).toMatch(
      /\.text-layout\.no-binder:not\(\.no-inspector\) \.panel-edge-toggle--left:not\(\.is-open\)\s*\{[^}]*var\(--space-24\) \+\s*var\(--editor-balance-offset\)/s,
    );
    expect(workspaceCss).toMatch(
      /\.text-layout\.no-inspector:not\(\.no-binder\) \.panel-edge-toggle--right:not\(\.is-open\)\s*\{[^}]*var\(--space-24\) -\s*var\(--editor-balance-offset\)/s,
    );
    expect(turnCss).toMatch(
      /\.chapter-turn__action\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s,
    );
    expect(turnCss).toMatch(
      /\.chapter-turn\[data-active="true"\] \.chapter-turn__action,[\s\S]*?\.chapter-turn__action:focus-visible\s*\{[^}]*pointer-events:\s*auto;/s,
    );
    expect(turnCss).toMatch(
      /\.chapter-turn__progress > span\s*\{[^}]*transform:\s*scaleX\(var\(--chapter-turn-progress\)\);/s,
    );
    expect(turnCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.chapter-turn__progress > span\s*\{[^}]*transition:\s*none;/s,
    );
    // Where nothing hovers, the way out of a chapter has to stand in the page.
    expect(turnCss).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.chapter-turn\s*\{[^}]*position:\s*static;/s,
    );
    expect(turnCss).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.chapter-turn\[data-active="true"\] \.chapter-turn__action\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s,
    );
    expect(editorCss).not.toMatch(/\.chapter-turn__action\s*\{/);
    expect(editorCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.editor-scroll\[data-chapter-turn="top"\] \.editor-page,[\s\S]*?transform:\s*none;/s,
    );
  });

  it("owns the tactile paper material on the manuscript surface only", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const editor = view.container.querySelector(".editor-scroll");

    expect(editor).toHaveAttribute("data-surface", "canvas");

    const root = join(process.cwd(), "packages/client/src");
    const editorCss = readFileSync(join(root, "modules/manuscript/EditorSurface.css"), "utf8");
    const scrollAreaCss = readFileSync(
      join(root, "design/components/ScrollArea/ScrollArea.css"),
      "utf8",
    );
    const colorsCss = readFileSync(join(root, "design/colors.css"), "utf8");
    const printCss = readFileSync(join(root, "modules/manuscript/PrintDocument.css"), "utf8");
    const texturePath = join(root, "modules/manuscript/assets/paper-fiber-texture.webp");
    const paperRule = editorCss.match(/\.editor-page\s*\{([^}]*)\}/s)?.[1];

    expect(paperRule, "EditorSurface.css must own the manuscript paper material").toBeDefined();
    // The sheet: the material belongs to the page, so the page also carries the edge and
    // the shadow that make it read as an object lying on the desk behind it.
    expect(paperRule).toMatch(/border-radius:\s*var\(--radius-xl\)/);
    expect(paperRule).toMatch(/box-shadow:\s*var\(--elevation-\d\) var\(--shadow-[a-z]+\);/);
    expect(paperRule).toMatch(/width:\s*min\([^;]*var\(--measure-prose\)\);/);
    expect(paperRule).toMatch(/background-color:\s*var\(--surface-paper\);/);
    expect(paperRule).not.toMatch(/var\(--(?:paper|ink|soft|line)\)/);
    expect(paperRule).not.toMatch(/(?<!var\(--)(?<!-)\btransparent\b/);

    const backgroundImage = paperRule?.match(/background-image:\s*([\s\S]*?);/)?.[1] ?? "";
    const textureLayers =
      backgroundImage.match(/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/g) ?? [];
    expect(textureLayers.length).toBeGreaterThanOrEqual(2);
    expect(backgroundImage).toMatch(/(?:var\(--|color-mix\()/);
    expect(backgroundImage).toContain('url("./assets/paper-fiber-texture.webp")');
    expect(backgroundImage).toContain("var(--material-paper-texture-veil)");
    expect(statSync(texturePath).size).toBeLessThanOrEqual(128 * 1024);
    expect(paperRule).toMatch(/background-blend-mode:\s*normal,\s*soft-light,\s*normal,\s*normal;/);

    const backgroundSize = paperRule?.match(/background-size:\s*([\s\S]*?);/)?.[1] ?? "";
    expect(backgroundSize.split(",").filter((layer) => layer.trim()).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(editorCss).not.toMatch(/\[data-theme=["'][^"']+["']\]/);
    const lightThemeRule = colorsCss.match(
      /:root,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
    )?.[1];
    const darkThemeRule = colorsCss.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/s)?.[1];
    expect(lightThemeRule).toBeDefined();
    expect(darkThemeRule).toBeDefined();
    const veilAlphaPattern = /--material-paper-texture-veil:\s*rgb\([^/]+\/\s*([\d.]+)\);/;
    const lightTextureVeil = Number(lightThemeRule?.match(veilAlphaPattern)?.[1]);
    const darkTextureVeil = Number(darkThemeRule?.match(veilAlphaPattern)?.[1]);
    expect(lightTextureVeil).toBeLessThanOrEqual(0.05);
    expect(darkTextureVeil).toBeGreaterThanOrEqual(0.9);
    expect(editorCss).toMatch(
      /@media \(prefers-contrast: more\)\s*\{[\s\S]*?\.editor-page\s*\{[^}]*background-image:\s*none;/s,
    );
    expect(editorCss).toMatch(
      /@media \(forced-colors: active\)\s*\{[\s\S]*?\.editor-page\s*\{[^}]*background-image:\s*none;/s,
    );

    const globalPaperRule = scrollAreaCss.match(
      /\.scroll-area\[data-surface="paper"\]\s*\{([^}]*)\}/s,
    )?.[1];
    expect(globalPaperRule).toBeDefined();
    expect(globalPaperRule).not.toMatch(/background(?:-color|-image)?\s*:/);
    expect(printCss).not.toMatch(/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(|\burl\(/i);
  });

  it("binds every toolbar group to the shared symmetric action strip", () => {
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const actions = view.container.querySelector(".manuscript-toolbar-actions");

    expect(actions).toBeInTheDocument();
    expect(actions?.querySelectorAll(":scope > .manuscript-toolbar-group").length).toBeGreaterThan(
      1,
    );
  });

  it("makes focus mode explicitly leavable", () => {
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

  it("hides the chapter picker when there is only one chapter", () => {
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

  it("changes persistable panel widths from the keyboard too", () => {
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
      screen.getByRole("separator", { name: "Details breiter oder schmaler ziehen" }),
      { key: "ArrowLeft" },
    );
    expect(onSidebarWidth).toHaveBeenCalledWith(256);
    expect(onInspectorWidth).toHaveBeenCalledWith(304);
  });

  it("lets both columns be reopened from the discreet margin switches", () => {
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
    const writingAid = rendered.getByRole("button", { name: "Details öffnen" });
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    expect(writingAid).toHaveAttribute("aria-controls", "writing-aid-inspector");
    expect(writingAid.querySelector(".lucide-panel-right")).not.toBeNull();
    expect(writingAid.querySelector(".lucide-pilcrow")).toBeNull();
    fireEvent.click(writingAid);
    expect(onInspectorOpen).toHaveBeenCalledWith(true);
  });

  it("shows the upper panel switches on desktop and really flips both sides", () => {
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
    const toolbar = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    const chapters = toolbar.getByRole("button", { name: "Kapitel" });
    const writingAid = toolbar.getByRole("button", { name: "Details" });

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
    expect(rendered.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(writingAid);
    expect(rendered.getByRole("complementary", { name: "Details" })).toBeVisible();
  });

  it("reports the writing aid without a chapter as neither open nor controlling", () => {
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
    const writingAid = within(
      within(view.container).getByRole("toolbar", { name: "Manuskript" }),
    ).getByRole("button", { name: "Details" });
    expect(writingAid).toBeDisabled();
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
    expect(writingAid).toHaveAttribute("aria-pressed", "false");
    expect(writingAid).not.toHaveAttribute("aria-controls");
    expect(rendered.queryByRole("complementary", { name: "Details" })).toBeNull();
    fireEvent.click(writingAid);
    expect(onInspectorOpen).not.toHaveBeenCalled();
  });

  it("opens at the text edge and closes beside the heading outside focus mode", () => {
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
    expect(rendered.queryByRole("button", { name: "Kapitelnavigation öffnen" })).toBeNull();
    const closeBinder = within(binder).getByRole("button", {
      name: "Kapitelnavigation schließen",
    });
    expect(closeBinder.closest(".chapter-binder__header")).not.toBeNull();
    fireEvent.click(closeBinder);
    expect(rendered.queryByRole("complementary", { name: "Kapitel" })).toBeNull();
    expect(rendered.getByRole("button", { name: "Kapitelnavigation öffnen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(rendered.getByRole("button", { name: "Details öffnen" }));
    const aid = rendered.getByRole("complementary", { name: "Details" });
    expect(aid).toHaveAttribute("id", "writing-aid-inspector");
    expect(rendered.queryByRole("button", { name: "Details öffnen" })).toBeNull();
    const closeAid = within(aid).getByRole("button", { name: "Details schließen" });
    expect(closeAid.closest(".manuscript-inspector__header")).not.toBeNull();
    expect(closeAid.parentElement?.firstElementChild).toBe(closeAid);
    fireEvent.click(closeAid);
    expect(rendered.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(rendered.getByRole("button", { name: "Details öffnen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("still uses the context bar's sheet switches in the compact layout", () => {
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
    expect(rendered.queryByRole("button", { name: "Details öffnen" })).toBeNull();
    const context = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    expect(context.getByRole("button", { name: "Kapitel" })).toBeVisible();
    expect(context.getByRole("button", { name: "Details" })).toBeVisible();
  });

  it("opens and closes both compact sheets from the toolbar and the panel X", () => {
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
    const toolbar = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Kapitel" }));
    const chapters = screen.getByRole("dialog", { name: "Kapitel" });
    fireEvent.click(within(chapters).getByRole("button", { name: "Kapitelnavigation schließen" }));
    expect(screen.queryByRole("dialog", { name: "Kapitel" })).toBeNull();
    fireEvent.click(toolbar.getByRole("button", { name: "Details" }));
    const writingAid = screen.getByRole("dialog", { name: "Details" });
    fireEvent.click(within(writingAid).getByRole("button", { name: "Details schließen" }));
    expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
  });

  it("keeps the discreet opening switches in focus mode and no toolbar duplication", () => {
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
    const writingAid = rendered.getByRole("button", { name: "Details öffnen" });
    expect(writingAid.querySelector(".lucide-panel-right")).not.toBeNull();
    fireEvent.click(writingAid);
    expect(writingAid).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(writingAid);
    expect(writingAid).toHaveAttribute("aria-expanded", "false");
  });

  it("separates structure on the left from controls on the right", () => {
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
    const rendered = within(view.container);
    const binder = within(rendered.getByRole("complementary", { name: "Kapitel" }));
    const details = within(rendered.getByRole("complementary", { name: "Details" }));

    // The left only says which chapter is meant.
    expect(binder.queryByLabelText("Kapitelnotiz")).toBeNull();
    expect(binder.queryByText("Handlungszeit")).toBeNull();

    // The right says what happens to it -- in two sections under one head.
    expect(details.getByRole("radio", { name: "Kapitel" })).toBeChecked();
    expect(details.getByLabelText("Kapitelnotiz")).toBeTruthy();
    expect(details.getByText("Handlungszeit")).toBeTruthy();
    expect(details.getByRole("button", { name: "Kapitel löschen" })).toBeTruthy();
    expect(details.queryByRole("tab", { name: "Nachschlagen" })).toBeNull();

    fireEvent.click(details.getByRole("radio", { name: "Schreibhilfe" }));
    expect(details.getByRole("tab", { name: "Nachschlagen" })).toBeTruthy();
    expect(details.queryByLabelText("Kapitelnotiz")).toBeNull();
  });
});
