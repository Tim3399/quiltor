import type { Page } from "@playwright/test";
import { mockExampleWorld } from "./support/example-world";
import { waitForSettledLayout } from "./support/layout-settled";
import { expect, test } from "./support/transient-network";

/*
 * T-258: undo and redo sit in the same place in every workspace and at every width -- in the
 * toolbar row, visible as icons, after the toggles and before "Weitere Aktionen" (styleguide
 * 7.4). Places and the manuscript used to move them into the overflow menu on a phone.
 *
 * The widths are those the toolbar rules are cut at: the brief's 1280 and 820, and the phones
 * from 430 down to 360 where a compact row holds at most six touch buttons.
 */
const WIDTHS = [1280, 820, 430, 412, 390, 375, 360];
const WORKSPACES = ["Text", "Figuren", "Orte", "Timeline", "Storyboard"] as const;

// The test walks every width itself, so one project is enough.
test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "walks its own widths");
});

async function openWorld(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockExampleWorld(page);
  await page.goto("/?world=example-world");
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
}

type Placement = {
  undoVisible: boolean;
  redoVisible: boolean;
  insideViewport: boolean;
  sameRow: boolean;
  after: string[];
  scrolled: string[];
};

/** Where undo and redo sit in the visible toolbar, measured in the page. */
function placement(): Placement | null {
  const toolbars = [...document.querySelectorAll<HTMLElement>('[role="toolbar"]')].filter(
    (toolbar) => toolbar.getClientRects().length > 0,
  );
  for (const toolbar of toolbars) {
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.getClientRects().length > 0,
    );
    const name = (button: HTMLButtonElement) =>
      button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
    const undo = buttons.find((button) => name(button) === "Rückgängig");
    const redo = buttons.find((button) => name(button) === "Wiederholen");
    if (!undo && !redo) continue;
    const visible = (button?: HTMLButtonElement) => {
      if (!button) return false;
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width > 0 && box.height > 0 && (hit === button || button.contains(hit));
    };
    const inside = [undo, redo].every((button) => {
      if (!button) return false;
      const box = button.getBoundingClientRect();
      return box.left >= -0.5 && box.right <= window.innerWidth + 0.5;
    });
    const undoBox = undo?.getBoundingClientRect();
    const redoBox = redo?.getBoundingClientRect();
    const index = redo ? buttons.indexOf(redo) : -1;
    const scrolled = [...toolbar.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowX;
        return (
          (overflow === "auto" || overflow === "scroll") &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .map((element) => element.className || element.tagName);
    return {
      undoVisible: visible(undo),
      redoVisible: visible(redo),
      insideViewport: inside,
      sameRow: Boolean(undoBox && redoBox && Math.abs(undoBox.top - redoBox.top) < 2),
      after: index < 0 ? [] : buttons.slice(index + 1).map(name),
      scrolled,
    };
  }
  return null;
}

// One test walks all workspaces: the Windows CI slots hold at most 100 listed tests each.
test("undo and redo stay in the row of every workspace at every width", async ({ page }) => {
  await openWorld(page);
  const start = page.viewportSize() ?? { width: 1440, height: 900 };
  const findings: string[] = [];
  for (const workspace of WORKSPACES) {
    await page.setViewportSize(start);
    await waitForSettledLayout(page);
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await waitForSettledLayout(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: start.height });
      await waitForSettledLayout(page);
      const at = `${workspace} ${width}px`;
      const found = await page.evaluate(placement);
      if (!found) {
        findings.push(`${at}: no visible toolbar holds "Rückgängig" and "Wiederholen"`);
        continue;
      }
      if (!found.undoVisible || !found.redoVisible) {
        findings.push(`${at}: undo or redo is not visible in the row`);
      }
      if (!found.insideViewport) findings.push(`${at}: undo or redo is outside the viewport`);
      if (!found.sameRow) findings.push(`${at}: undo and redo are split across rows`);
      if (found.after.some((name) => name !== "Weitere Aktionen")) {
        findings.push(`${at}: after redo come ${JSON.stringify(found.after)}`);
      }
      if (found.scrolled.length) {
        findings.push(`${at}: the row scrolls (${found.scrolled.join(", ")})`);
      }
    }
  }
  expect(findings).toEqual([]);
});
