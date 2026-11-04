import { expect, type Page, test } from "@playwright/test";
import { analyzeLayout } from "./support/layout-rules";
import type { Finding, LayoutContext } from "./support/types";

// Each rule is exercised on synthetic HTML, once where it must fire and once where it must not.

const BASE_CSS =
  "<style>html,body{margin:0;padding:0;background:#fff;color:#111;font:16px sans-serif}</style>";

async function analyze(
  page: Page,
  html: string,
  context: Partial<LayoutContext> = {},
  viewport = { width: 400, height: 600 },
): Promise<Finding[]> {
  await page.setViewportSize(viewport);
  await page.setContent(`${BASE_CSS}${html}`);
  return analyzeLayout(page, { viewport: "mobile", touch: false, ...context });
}

const byRule = (findings: Finding[], rule: string) =>
  findings.filter((finding) => finding.rule === rule);

test.describe("page-horizontal-scroll", () => {
  test("reports content wider than the viewport", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:900px;height:20px;background:#ccc"></div>',
    );
    const hits = byRule(findings, "page-horizontal-scroll");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "rules", severity: "high", selector: "html" });
    expect(hits[0].message).toContain("900px");
  });

  test("stays quiet when the content fits", async ({ page }) => {
    const findings = await analyze(page, "<p>Short line.</p>");
    expect(byRule(findings, "page-horizontal-scroll")).toEqual([]);
  });
});

test.describe("outside-viewport", () => {
  test("reports a fixed button that sticks out on the left", async ({ page }) => {
    const findings = await analyze(
      page,
      '<button id="lost" style="position:fixed;left:-40px;top:10px;width:100px;height:48px">Lost</button>',
    );
    const hits = byRule(findings, "outside-viewport");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "high", selector: "button#lost" });
    expect(hits[0].message).toContain("left by 40px");
    expect(hits[0].rect).toMatchObject({ x: -40, y: 10, width: 100, height: 48 });
  });

  test("ignores content that a scroll container can reach", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div style="width:300px;overflow-x:auto">
        <div style="width:1000px"><button style="margin-left:600px;width:100px;height:48px">Far</button></div>
      </div>`,
    );
    expect(byRule(findings, "outside-viewport")).toEqual([]);
  });

  test("ignores content below the fold of a scrollable page", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="height:2000px"></div><button style="width:100px;height:48px">Below</button>',
    );
    expect(byRule(findings, "outside-viewport")).toEqual([]);
  });

  test("ignores elements clipped away entirely by overflow hidden", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:200px;overflow:hidden"><button style="margin-left:500px;width:100px;height:48px">Hidden</button></div>',
    );
    expect(byRule(findings, "outside-viewport")).toEqual([]);
  });
});

test.describe("popup-outside-viewport", () => {
  const popup = (left: number) =>
    `<div id="pop" role="menu" style="position:fixed;left:${left}px;top:20px;width:200px;height:100px;background:#eee">Menu</div>`;

  test("reports an open popup that extends beyond the right edge", async ({ page }) => {
    const findings = await analyze(page, popup(300), { popupSelector: "#pop" });
    const hits = byRule(findings, "popup-outside-viewport");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "medium", selector: "div#pop" });
    expect(hits[0].message).toContain("right by 100px");
  });

  test("rates a mostly hidden popup high", async ({ page }) => {
    const findings = await analyze(page, popup(360), { popupSelector: "#pop" });
    expect(byRule(findings, "popup-outside-viewport")[0]?.severity).toBe("high");
  });

  test("stays quiet for a popup inside the viewport", async ({ page }) => {
    const findings = await analyze(page, popup(100), { popupSelector: "#pop" });
    expect(byRule(findings, "popup-outside-viewport")).toEqual([]);
  });

  test("does not apply without a popup selector", async ({ page }) => {
    const findings = await analyze(page, popup(300));
    expect(byRule(findings, "popup-outside-viewport")).toEqual([]);
  });
});

test.describe("clipped-text", () => {
  const box = (attributes: string, style: string) =>
    `<div ${attributes} style="width:60px;overflow:hidden;white-space:nowrap;${style}">A very long chapter title that cannot fit</div>`;

  test("reports text cut off without an ellipsis as high", async ({ page }) => {
    const findings = await analyze(page, box('id="cut"', ""));
    const hits = byRule(findings, "clipped-text");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "high", selector: "div#cut" });
  });

  test("downgrades an ellipsis with a title to low", async ({ page }) => {
    const findings = await analyze(
      page,
      box('title="A very long chapter title that cannot fit"', "text-overflow:ellipsis"),
    );
    expect(byRule(findings, "clipped-text")[0]?.severity).toBe("low");
  });

  test("rates an ellipsis without title or ARIA as medium", async ({ page }) => {
    const findings = await analyze(page, box("", "text-overflow:ellipsis"));
    expect(byRule(findings, "clipped-text")[0]?.severity).toBe("medium");
  });

  test("stays quiet when the text fits", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:300px;overflow:hidden;white-space:nowrap">Short</div>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("stays quiet for a visually hidden sr-only label", async ({ page }) => {
    const findings = await analyze(
      page,
      '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Skip to the chapter list</span>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("reports a long word cut off in a visible 120px box", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div id="word" style="width:120px;overflow:hidden">Donaudampfschifffahrtsgesellschaftskapitaen</div>',
    );
    const hits = byRule(findings, "clipped-text");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "high", selector: "div#word" });
  });

  test("stays quiet for scroll containers", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:60px;overflow:auto;white-space:nowrap">A very long chapter title that cannot fit</div>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("reports text cut off in a nested block of a clipping box", async ({ page }) => {
    const findings = await analyze(
      page,
      '<aside id="panel" style="width:120px;overflow:hidden"><div><p>Donaudampfschifffahrtsgesellschaftskapitaen</p></div></aside>',
    );
    const hits = byRule(findings, "clipped-text");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "high", selector: "aside#panel" });
    expect(hits[0].message).toContain("Donaudampf");
  });

  test("reports text pushed below a clipping box vertically", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div id="short" style="width:200px;height:20px;overflow:hidden"><p style="margin:0">First line</p><p style="margin:0">Second line</p></div>',
    );
    expect(byRule(findings, "clipped-text")).toHaveLength(1);
  });

  test("stays quiet when a descendant box is larger but no text is cut", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:200px;height:60px;overflow:hidden"><span>Fits</span><div style="width:500px;height:10px;background:#ccc"></div></div>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("stays quiet when an inner scroller owns the overflowing text", async ({ page }) => {
    const findings = await analyze(
      page,
      '<aside style="width:200px;height:100px;overflow:hidden"><div style="height:150px;overflow-y:auto"><p style="margin:0">One</p><p style="margin:0;margin-top:300px">Far below</p></div></aside>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("stays quiet for a pan surface whose content lies beyond the window", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:300px;height:200px;overflow:hidden;position:relative"><div style="position:absolute;inset:0;transform:translate(0,0) scale(1)"><div style="position:absolute;left:900px;top:40px">Node far to the right</div><div style="position:absolute;left:10px;top:600px">Node far below</div></div></div>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });

  test("stays quiet for the content of a collapsed details element", async ({ page }) => {
    const findings = await analyze(
      page,
      '<details style="width:200px;height:30px;overflow:hidden"><summary>Title</summary><p>Hidden body that is long enough to wrap onto several lines of text in the box</p></details>',
    );
    expect(byRule(findings, "clipped-text")).toEqual([]);
  });
});

test.describe("overlap", () => {
  test("reports two buttons stacked on each other", async ({ page }) => {
    const findings = await analyze(
      page,
      `<button id="a" style="position:absolute;left:10px;top:10px;width:100px;height:48px">A</button>
       <button id="b" style="position:absolute;left:20px;top:20px;width:100px;height:48px">B</button>`,
    );
    const hits = byRule(findings, "overlap");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("high");
    expect(hits[0].message).toContain("button#b");
  });

  test("reports a corner-only overlap with a lower severity", async ({ page }) => {
    const findings = await analyze(
      page,
      `<button id="a" style="position:absolute;left:10px;top:10px;width:100px;height:100px">A</button>
       <button id="b" style="position:absolute;left:90px;top:90px;width:100px;height:100px">B</button>`,
    );
    const hits = byRule(findings, "overlap");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("low");
  });

  test("stays quiet for neighbours", async ({ page }) => {
    const findings = await analyze(
      page,
      `<button style="position:absolute;left:10px;top:10px;width:100px;height:48px">A</button>
       <button style="position:absolute;left:120px;top:10px;width:100px;height:48px">B</button>`,
    );
    expect(byRule(findings, "overlap")).toEqual([]);
  });

  test("allows a popup layer to float over a control", async ({ page }) => {
    const findings = await analyze(
      page,
      `<button style="position:absolute;left:10px;top:10px;width:200px;height:48px">Behind</button>
       <div role="menu" style="position:absolute;left:10px;top:10px;width:200px;height:100px;background:#eee">
         <button role="menuitem" style="width:200px;height:48px">Item</button>
       </div>`,
    );
    expect(byRule(findings, "overlap")).toEqual([]);
  });
});

test.describe("overlap of stacked overlays", () => {
  const stacked = [".trail", ".banner", ".legend"];

  test("reports a hint banner that lies over a breadcrumb trail", async ({ page }) => {
    // Neither is a control the rule above counts, so only the named stack finds it.
    const findings = await analyze(
      page,
      `<nav class="trail" style="position:absolute;left:10px;top:10px;width:200px;height:30px;background:#ddd">Pfad</nav>
       <div class="banner" style="position:absolute;left:100px;top:10px;width:250px;height:40px;background:#eef">Hinweis</div>`,
      { stackedSelectors: stacked },
    );
    const hits = byRule(findings, "overlap");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("high");
    expect(hits[0].message).toContain(".trail");
    expect(hits[0].message).toContain(".banner");
  });

  test("stays quiet for overlays that stack in one column", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div style="display:flex;flex-direction:column;gap:4px;width:300px">
         <nav class="trail" style="height:30px">Pfad</nav>
         <div class="banner" style="height:40px">Hinweis</div>
         <div class="legend" style="height:50px">Maßstab</div>
       </div>`,
      { stackedSelectors: stacked },
    );
    expect(byRule(findings, "overlap")).toEqual([]);
  });

  test("does nothing for a state that names no stack", async ({ page }) => {
    const findings = await analyze(
      page,
      `<nav class="trail" style="position:absolute;left:10px;top:10px;width:200px;height:30px">Pfad</nav>
       <div class="banner" style="position:absolute;left:100px;top:10px;width:250px;height:40px">Hinweis</div>`,
    );
    expect(byRule(findings, "overlap")).toEqual([]);
  });
});

test.describe("broken-word", () => {
  // A box too narrow for the word, and a break rule that lets it split anyway.
  const narrow = (tag: string, text: string, extra = "") =>
    `<${tag} id="cut" style="display:block;width:60px;font:16px monospace;overflow-wrap:anywhere;${extra}">${text}</${tag}>`;

  test("reports a button label split inside its word", async ({ page }) => {
    const findings = await analyze(page, narrow("button", "MASSSTAB"));
    const hits = byRule(findings, "broken-word");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "high", selector: "button#cut" });
    const parts = /\("([A-Z]+)" \/ "([A-Z]+)"\)/.exec(hits[0].message);
    expect(hits[0].message).toContain('The word "MASSSTAB" breaks');
    expect(parts?.[1].length).toBeGreaterThan(0);
    expect(`${parts?.[1]}${parts?.[2]}`).toBe("MASSSTAB");
  });

  test("rates a split inside running text as medium", async ({ page }) => {
    const findings = await analyze(page, narrow("p", "Weltkartenrand"));
    const hits = byRule(findings, "broken-word");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("medium");
  });

  test("reports a word split by a forced break-all", async ({ page }) => {
    const findings = await analyze(
      page,
      '<h2 style="width:50px;font:16px monospace;word-break:break-all">Maßstab</h2>',
    );
    const hits = byRule(findings, "broken-word");
    expect(hits.map((hit) => hit.severity)).toEqual(["high"]);
    expect(hits[0].message).toContain('The word "Maßstab" breaks');
  });

  test("allows hyphenation with hyphens: auto", async ({ page }) => {
    const findings = await analyze(
      page,
      `<p lang="de" style="width:60px;font:16px monospace;hyphens:auto;overflow-wrap:anywhere">Weltkartenrand</p>`,
    );
    expect(byRule(findings, "broken-word")).toEqual([]);
  });

  test("allows a break after a hyphen or at a soft hyphen", async ({ page }) => {
    const findings = await analyze(
      page,
      `<p style="width:60px;font:16px monospace">Ort-Karte</p>
       <p style="width:60px;font:16px monospace;hyphens:manual">Welt&shy;karte</p>`,
    );
    expect(byRule(findings, "broken-word")).toEqual([]);
  });

  test("stays quiet for words that wrap between each other", async ({ page }) => {
    const findings = await analyze(
      page,
      '<button style="width:60px;font:16px monospace">Ort Karte Pin</button>',
    );
    expect(byRule(findings, "broken-word")).toEqual([]);
  });

  test("lets machine text and the author's own text break anywhere", async ({ page }) => {
    const findings = await analyze(
      page,
      `${narrow("code", "/Welten/Sicherungen")}
       <div contenteditable="true">${narrow("p", "Sturmflutwarnung")}</div>`,
    );
    expect(byRule(findings, "broken-word")).toEqual([]);
  });

  test("ignores text that is hidden for screen readers only", async ({ page }) => {
    const findings = await analyze(
      page,
      narrow(
        "label",
        "MASSSTAB",
        "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)",
      ),
    );
    expect(byRule(findings, "broken-word")).toEqual([]);
  });
});

test.describe("touch-target", () => {
  const button = (size: number) =>
    `<button style="width:${size}px;height:${size}px;padding:0;border:1px solid #333">x</button>`;

  test("rates a target below 24px as high", async ({ page }) => {
    const findings = await analyze(page, button(20), { touch: true });
    const hits = byRule(findings, "touch-target");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("high");
    expect(hits[0].message).toContain("20x20");
  });

  test("rates a target below 44px as low", async ({ page }) => {
    const findings = await analyze(page, button(32), { touch: true });
    expect(byRule(findings, "touch-target")[0]?.severity).toBe("low");
  });

  test("accepts a 44px target", async ({ page }) => {
    const findings = await analyze(page, button(44), { touch: true });
    expect(byRule(findings, "touch-target")).toEqual([]);
  });

  test("does not apply without touch", async ({ page }) => {
    const findings = await analyze(page, button(20), { touch: false });
    expect(byRule(findings, "touch-target")).toEqual([]);
  });

  test("exempts inline links inside running text", async ({ page }) => {
    const findings = await analyze(page, '<p>Read the <a href="#x">manual</a> first.</p>', {
      touch: true,
    });
    expect(byRule(findings, "touch-target")).toEqual([]);
  });
});

test.describe("contrast", () => {
  test("reports light grey text on white", async ({ page }) => {
    const findings = await analyze(page, '<p id="faint" style="color:#cccccc">Barely readable</p>');
    const hits = byRule(findings, "contrast");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "rules", selector: "#faint" });
    expect(hits[0].rect?.width).toBeGreaterThan(0);
  });

  test("accepts dark text on white", async ({ page }) => {
    const findings = await analyze(page, '<p style="color:#111111">Readable</p>');
    expect(byRule(findings, "contrast")).toEqual([]);
  });
});

test.describe("toolbar-row", () => {
  const button = (label: string) =>
    `<button style="width:90px;height:32px;flex:none">${label}</button>`;

  test("reports a toolbar whose last button wraps onto a second row", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div role="toolbar" aria-label="Werkzeuge" style="display:flex;flex-wrap:wrap;width:300px">
        ${button("Notiz")}${button("Gruppe")}${button("Vorne")}${button("Undo")}
      </div>`,
    );
    const hits = byRule(findings, "toolbar-row");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("high");
    expect(hits[0].message).toContain("wraps onto 2 rows");
    expect(hits[0].message).toContain('"Undo"');
  });

  test("reports a button cut off by the toolbar's overflow", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div role="toolbar" aria-label="Werkzeuge" style="display:flex;width:300px;overflow:hidden">
        ${button("Notiz")}${button("Gruppe")}${button("Vorne")}${button("Hinten")}
      </div>`,
    );
    const hits = byRule(findings, "toolbar-row");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain("is hidden or cut off");
  });

  test("reports a scroll strip whose scrollbar lies over the buttons", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div role="toolbar" aria-label="Werkzeuge" style="width:300px">
        <div style="display:flex;overflow-x:auto;height:32px">
          ${button("Kapitel")}${button("Details")}${button("Fokus")}${button("Fassungen")}
        </div>
      </div>`,
    );
    const hits = byRule(findings, "toolbar-row");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.message.includes("is hidden or cut off"))).toBe(true);
  });

  test("reports a button that CSS removes from the toolbar", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div role="toolbar" aria-label="Werkzeuge" style="display:flex;width:390px">
        ${button("Notiz")}<span style="display:none">${button("Undo")}</span>
        <button style="width:90px;height:32px;visibility:hidden">Redo</button>
      </div>`,
    );
    const hits = byRule(findings, "toolbar-row");
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.message.includes("is removed by CSS"))).toBe(true);
    expect(hits[0].message).toContain('"Undo"');
    expect(hits[1].message).toContain('"Redo"');
  });

  test("stays quiet for a toolbar that fits on one row", async ({ page }) => {
    const findings = await analyze(
      page,
      `<div role="toolbar" aria-label="Werkzeuge" style="display:flex;flex-wrap:wrap;width:390px">
        ${button("Notiz")}${button("Gruppe")}${button("Mehr")}
        <div role="menu" hidden>${button("Vorne")}</div>
      </div>`,
    );
    expect(byRule(findings, "toolbar-row")).toEqual([]);
  });
});
