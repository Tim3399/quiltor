import type { Page } from "@playwright/test";
import { expect } from "./transient-network";

/**
 * Wait until the page's layout stands still: every element's box the same in two samples taken
 * `interval` ms apart inside the page. Replaces fixed waits after a canvas fit, a zoom or a drag,
 * which end when their animation does, not after a guessed time.
 */
export async function waitForSettledLayout(page: Page, { interval = 150, timeout = 10_000 } = {}) {
  await expect
    .poll(
      () =>
        page.evaluate(async (pause) => {
          const sample = () => {
            const parts: string[] = [];
            for (const element of document.querySelectorAll("body *")) {
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) continue;
              parts.push(
                `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`,
              );
            }
            return parts.join(";");
          };
          const before = sample();
          await new Promise((resolve) => setTimeout(resolve, pause));
          return sample() === before;
        }, interval),
      { intervals: [0], timeout, message: "the layout never stood still" },
    )
    .toBe(true);
}
