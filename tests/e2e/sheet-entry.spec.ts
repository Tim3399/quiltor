import { createTestWorld, expect, test } from "./support/world-fixture";

/**
 * T-70 / F6: the history dialog was once measured 369 px beyond a 1441 px viewport, on macOS.
 *
 * The sheet is 880 px wide and its backdrop is fixed to the viewport, so its edge can only pass
 * the viewport through the entry transform. The failure screenshot shows it in the middle of
 * its slide, after the first measurement had found it standing still. `.ui-sheet` has no
 * `animation-fill-mode`: until the animation actually starts, the sheet is drawn at its final
 * place, and then it jumps out to the right and slides back in. A runner that starts the
 * animation late shows exactly that.
 *
 * The delay below is that late start on purpose, at the same width.
 */
test("A sheet stays out of sight until its entry animation runs, then settles inside the viewport", async ({
  page,
}) => {
  const world = await createTestWorld(page, "Sheet-Eintritt");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.addStyleTag({ content: ".ui-sheet { animation-delay: 2s !important; }" });

  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Verlauf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Verlauf", exact: true });
  await expect(dialog).toBeVisible();

  // Still waiting for its animation: not a pixel of it may be drawn inside the viewport.
  const waiting = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      animations: element.getAnimations().map((animation) => animation.playState),
    };
  });
  expect(waiting.animations, "the delayed entry animation").toEqual(["running"]);
  const outsideRight = waiting.left >= waiting.viewportWidth - 1;
  const outsideBelow = waiting.top >= waiting.viewportHeight - 1;
  expect(
    outsideRight || outsideBelow,
    `the sheet stood at left ${waiting.left}, top ${waiting.top} in a ${waiting.viewportWidth}x${waiting.viewportHeight} viewport before its animation began`,
  ).toBe(true);

  // Once the animation is over, the sheet lies within the viewport.
  await expect.poll(() => dialog.evaluate((element) => element.getAnimations().length)).toBe(0);
  const settled = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(settled.left).toBeGreaterThanOrEqual(-1);
  expect(settled.right).toBeLessThanOrEqual(settled.viewportWidth + 1);
  expect(settled.bottom).toBeLessThanOrEqual(settled.viewportHeight + 1);
});
