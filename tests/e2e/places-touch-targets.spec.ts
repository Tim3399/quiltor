import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// T-219 / F-2b, D-T-219-F2: the commands of a place card need 44px touch targets you can see
// and reach (design-product-matrix.spec.ts), not the 24px of WCAG. A fitted canvas draws a card
// at about 98 x 45 px, so they do not fit on it:
// - on a touch screen wide enough for the inspector to be a side panel, they hang below the
//   card that is meant;
// - on a phone the inspector is a sheet over the whole canvas, so the card carries none and
//   the sheet offers them.
// Reachable means the point in a command's middle hits that command, not whatever covers it.
// A tap on a card only selects it: it never fires a command that appeared under the finger.

const MINIMUM = 44;

async function openPlaces(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
  await seedExampleWorld(page);
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".place-node-shell").first()).toBeVisible();
}

function placeCard(page: Page, map: boolean): Locator {
  return page
    .locator(".place-node-shell")
    .filter({ has: page.locator(map ? ".story-node.is-map" : ".story-node:not(.is-map)") })
    .first();
}

async function placeName(shell: Locator) {
  const name = (await shell.locator(".story-node strong").first().textContent())?.trim() ?? "";
  expect(name).not.toBe("");
  return name;
}

function cardCommands(scope: Locator, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByRole("button", {
    name: new RegExp(
      `^(Ort ${escaped} als Stecknadel anzeigen|In ${escaped} etwas anlegen|${escaped} öffnen|${escaped} aufklappen)$`,
    ),
  });
}

async function placeId(shell: Locator) {
  const id = await shell.evaluate(
    (element) => element.closest(".react-flow__node")?.getAttribute("data-id") ?? "",
  );
  expect(id).not.toBe("");
  return id;
}

/** Size and reachability of every control in `scope`, measured where the user would tap:
 * scrolled into view, as a user would scroll the sheet, once nothing moves any more. */
async function measure(scope: Locator) {
  return scope.evaluateAll(async (elements) => {
    // A cancelled animation rejects `finished` with an AbortError (it happens on macOS);
    // cancelled, it does not move anything either, so it counts as settled.
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
    return elements.map((element) => {
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        reachable: !!hit && (hit === element || element.contains(hit)),
      };
    });
  });
}

function expectTouchSized(boxes: Awaited<ReturnType<typeof measure>>) {
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.label} is narrower than ${MINIMUM}px`).toBeGreaterThanOrEqual(
      MINIMUM - 1,
    );
    expect(box.height, `${box.label} is lower than ${MINIMUM}px`).toBeGreaterThanOrEqual(
      MINIMUM - 1,
    );
    expect(box.reachable, `${box.label} is covered where it would be tapped`).toBe(true);
  }
}

test.describe("on a phone", () => {
  test("a place card carries no commands; a tap selects it and the sheet offers them at 44px", async ({
    page,
  }) => {
    await openPlaces(page, 390, 844);
    const zoom = await page
      .locator(".place-node-shell")
      .first()
      .evaluate((shell) => Number(getComputedStyle(shell).getPropertyValue("--place-card-zoom")));
    expect(zoom, "the canvas is not zoomed out; the test would prove nothing").toBeLessThan(0.7);
    await expect(page.locator(".place-node-shell .place-node__enter:visible")).toHaveCount(0);

    const shell = placeCard(page, false);
    const id = await placeId(shell);
    const card = shell.locator(".story-node");
    await card.click({ position: { x: 8, y: 8 } });
    await expect(card).toHaveClass(/\bselected\b/);
    await expect(page.locator(`.place-node-pin[data-place-id="${id}"]`)).toHaveCount(0);
    // Selected, the card still shows none: they would lie under the sheet.
    await expect(shell.locator(".place-node__enter:visible")).toHaveCount(0);

    const sheet = page.getByRole("dialog", { name: "Orte-Inspector" });
    await expect(sheet).toBeVisible();
    const name = await placeName(shell);
    // The display toggle and the level: both of the card's commands, in the sheet.
    const commands = cardCommands(sheet, name);
    await expect(commands).toHaveCount(2);
    expectTouchSized(await measure(commands));

    // The level command works from the sheet: the sheet closes on the place's own level.
    await sheet
      .getByRole("button", { name: new RegExp(`In ${name} etwas anlegen|${name} öffnen`) })
      .click();
    await expect(sheet).toBeHidden();
  });

  test("the sheet of a map offers to open it out", async ({ page }) => {
    await openPlaces(page, 390, 844);
    const shell = placeCard(page, true);
    const name = await placeName(shell);
    await shell.locator(".story-node").click({ position: { x: 60, y: 20 } });
    const sheet = page.getByRole("dialog", { name: "Orte-Inspector" });
    const commands = cardCommands(sheet, name);
    // Open out and the level -- a map has no pin.
    await expect(commands).toHaveCount(2);
    expectTouchSized(await measure(commands));
  });
});

test.describe("on a wide touch screen", () => {
  test.use({ hasTouch: true });

  test("the commands hang below the card that is meant, 44px, and a tap only selects", async ({
    page,
  }) => {
    // An iPad Pro in landscape: wide enough that the inspector is a side panel. The map card
    // stands clear of that panel in the fitted world.
    await openPlaces(page, 1366, 1024);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    // Zoomed out, as a fitted larger world would be: a card px is then less than a screen px,
    // and the commands must make up for it.
    const zoomOf = () =>
      page
        .locator(".place-node-shell")
        .first()
        .evaluate((shell) => Number(getComputedStyle(shell).getPropertyValue("--place-card-zoom")));
    const zoomOut = page.locator(".react-flow__controls-zoomout");
    for (let step = 0; step < 8 && (await zoomOf()) >= 0.7; step += 1) await zoomOut.tap();
    await expect.poll(zoomOf, { message: "the canvas did not zoom out" }).toBeLessThan(0.7);
    await expect(page.locator(".place-node-shell .place-node__enter:visible")).toHaveCount(0);

    const shell = placeCard(page, true);
    const name = await placeName(shell);
    const card = shell.locator(".story-node");
    await card.tap({ position: { x: 60, y: 20 } });
    await expect(card).toHaveClass(/\bselected\b/);
    // Selected, not opened out: the tap did not reach the command that appeared.
    await expect(card).toHaveClass(/\bis-map\b/);
    await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(0);

    const buttons = cardCommands(shell, name);
    await expect(buttons).toHaveCount(2);
    const boxes = await measure(buttons);
    expectTouchSized(boxes);
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error("The selected card has no screen geometry.");
    for (const box of boxes) {
      expect(box.top, `${box.label} lies on the card`).toBeGreaterThanOrEqual(
        cardBox.y + cardBox.height - 0.5,
      );
    }
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        const overlap =
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 0.5 &&
          Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 0.5;
        expect(overlap, `${box.label} overlaps ${other.label}`).toBe(false);
      }
    }
    await expect(page.locator(".place-node-shell .place-node__enter:visible")).toHaveCount(
      boxes.length,
    );

    // The command below the card works with a tap of its own.
    await shell.getByRole("button", { name: `${name} aufklappen` }).tap();
    await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(1);
  });
});
