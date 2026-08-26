import { expect, test } from "@playwright/test";

const narrowHostWidth = 240;

test("long chip lists stay inside a narrow host", async ({ page }) => {
  await page.goto("/?story=Chip%2FLongWrappingList&theme=light");

  const canvas = page.locator('[data-design-story="Chip/LongWrappingList"]');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element, width) => {
    if (!(element instanceof HTMLElement)) throw new Error("Story canvas is not an element");
    element.style.width = `${width}px`;
    element.style.maxWidth = "100%";
  }, narrowHostWidth);

  const geometry = await canvas.evaluate((host) => {
    if (!(host instanceof HTMLElement)) throw new Error("Story canvas is not an element");
    const list = host.querySelector<HTMLElement>(".design-chip-list");
    if (!list) throw new Error("Chip story is incomplete");
    const chips = Array.from(list.querySelectorAll<HTMLElement>(".design-chip"));
    const labelOwners = chips.map(
      (chip) => chip.querySelector<HTMLElement>(".design-chip__label") ?? chip,
    );

    const hostStyle = getComputedStyle(host);
    const hostContentWidth =
      host.clientWidth -
      Number.parseFloat(hostStyle.paddingLeft) -
      Number.parseFloat(hostStyle.paddingRight);

    return {
      hostClientWidth: host.clientWidth,
      hostScrollWidth: host.scrollWidth,
      hostContentWidth,
      listWidth: list.getBoundingClientRect().width,
      chipCount: chips.length,
      overflowingLabelCount: labelOwners.filter(
        (label) => label.scrollWidth > label.clientWidth + 1,
      ).length,
      widestItem: Math.max(
        ...Array.from(list.children, (item) => item.getBoundingClientRect().width),
      ),
    };
  });

  expect(geometry.chipCount).toBe(3);
  expect(geometry.overflowingLabelCount).toBe(geometry.chipCount);
  expect(geometry.hostScrollWidth).toBeLessThanOrEqual(geometry.hostClientWidth + 1);
  expect(geometry.listWidth).toBeLessThanOrEqual(geometry.hostContentWidth + 1);
  expect(geometry.widestItem).toBeLessThanOrEqual(geometry.listWidth + 1);
});
