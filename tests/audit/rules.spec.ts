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

  test("stays quiet for scroll containers", async ({ page }) => {
    const findings = await analyze(
      page,
      '<div style="width:60px;overflow:auto;white-space:nowrap">A very long chapter title that cannot fit</div>',
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
