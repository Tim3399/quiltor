// Opens a context menu the way the viewport's input allows: right-click with a mouse; on touch a
// real long-press through CDP first, then Shift+F10 and the ContextMenu key as fallbacks.
import type { Locator, Page } from "@playwright/test";

type ContextMenuTrigger = "right-click" | "long-press" | "shift+f10" | "contextmenu-key";
type Point = { x: number; y: number };

/** Longer than any long-press threshold in the client (figure nodes use 550 ms). */
const LONG_PRESS_MS = 900;

/** A touch that stays put for LONG_PRESS_MS, dispatched as real touch input through CDP. */
async function longPress(page: Page, point: Point): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const touchPoints = [{ x: point.x, y: point.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    await page.waitForTimeout(LONG_PRESS_MS);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function visibleWithin(menu: Locator, timeout: number): Promise<boolean> {
  try {
    await menu.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tries the trigger paths in order and returns the first one after which `menu` is visible, or
 * null. `focus` prepares keyboard focus for the fallbacks (a focused node, a caret in a word).
 */
export async function openContextMenu(
  page: Page,
  options: {
    touch: boolean;
    point: () => Promise<Point>;
    menu: Locator;
    focus: () => Promise<void>;
    timeout?: number;
  },
): Promise<ContextMenuTrigger | null> {
  const timeout = options.timeout ?? 2_000;
  if (!options.touch) {
    const point = await options.point();
    await page.mouse.click(point.x, point.y, { button: "right" });
    return (await visibleWithin(options.menu, timeout)) ? "right-click" : null;
  }
  await longPress(page, await options.point());
  if (await visibleWithin(options.menu, timeout)) return "long-press";
  for (const [key, trigger] of [
    ["Shift+F10", "shift+f10"],
    ["ContextMenu", "contextmenu-key"],
  ] as const) {
    await page.keyboard.press("Escape");
    await options.focus();
    await page.keyboard.press(key);
    if (await visibleWithin(options.menu, timeout)) return trigger;
  }
  return null;
}

export async function centerOf(target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  const box = await target.boundingBox();
  if (!box) throw new Error("Target has no bounding box.");
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Viewport coordinates of the middle of `word` inside `container` (first occurrence). */
export async function wordPoint(container: Locator, word: string): Promise<Point> {
  const point = await container.evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      (node.parentElement as HTMLElement).scrollIntoView({ block: "center" });
      const rect = range.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    }
    return null;
  }, word);
  if (!point) throw new Error(`Word "${word}" is not on the page.`);
  return point;
}
