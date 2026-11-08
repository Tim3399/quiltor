import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// T-219 / F-2: on the places canvas of a 390px phone the world is fitted far out, and the
// icon buttons on the place cards shrink with the canvas -- 19x19 px on screen, under the 24px
// a pointer target needs (WCAG 2.2 AA 2.5.8, FRONTEND_STYLEGUIDE "Touch, Hover und Ziehen").
// The icon may stay small; the area that answers a tap may not. A button passes when a
// run of the card's commands through its centre reaches 24px both ways. Two neighbours at
// this zoom stand less than 24px apart, so the run may continue into the neighbour's button --
// that is still a command, never the card behind it. One px of slack is the pixel grid.

const MINIMUM = 24;

test("place card buttons keep a 24px hit area on a 390px canvas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
  await seedExampleWorld(page);
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".place-node-shell .place-node__enter").first()).toBeVisible();

  const report = await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(".place-node-shell .place-node__enter"),
    ];
    return buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const inView =
          rect.width > 0 &&
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const card = button.closest(".story-node");
        // How far, in px, an unbroken run of this card's commands reaches along one axis.
        const reach = (dx: number, dy: number) => {
          const answers = (t: number) => {
            const hit = document.elementFromPoint(cx + t * dx, cy + t * dy);
            const command = hit?.closest(".place-node__enter");
            return !!command && command.closest(".story-node") === card;
          };
          let lo = 0;
          let hi = 0;
          while (lo > -40 && answers(lo - 0.5)) lo -= 0.5;
          while (hi < 40 && answers(hi + 0.5)) hi += 0.5;
          return hi - lo;
        };
        return {
          label: button.getAttribute("aria-label"),
          width: rect.width,
          inView,
          horizontal: reach(1, 0),
          vertical: reach(0, 1),
        };
      })
      .filter((entry) => entry.inView);
  });

  expect(report.length, "no place card button is on screen to measure").toBeGreaterThan(0);
  // The premise: the canvas really is zoomed out so far that the buttons themselves are small.
  expect(
    report.some((entry) => entry.width < MINIMUM),
    "the canvas is not zoomed out; the test would prove nothing",
  ).toBe(true);
  expect(
    report.filter((entry) => Math.min(entry.horizontal, entry.vertical) < MINIMUM - 1),
  ).toEqual([]);
});
