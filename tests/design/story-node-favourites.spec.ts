import { expect, type Page, test } from "@playwright/test";

const favouriteIds = ["fav-libelle", "fav-hafen", "fav-mole"];

async function openScene(page: Page, theme: "light" | "dark" = "light") {
  await page.goto(`/?scene=story-node-favourites&theme=${theme}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(43);
  await expect(page.locator('[data-id="fav-libelle"] .story-node')).toBeVisible();
}

/** Which node owns the pixel at a point -- what the pointer would actually land on. */
function ownerAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>(".react-flow__node")?.dataset.id ??
      null,
    point,
  );
}

async function centreOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a favourite lies on top and is not covered by ordinary markers", async ({ page }) => {
  await openScene(page);

  for (const id of favouriteIds) {
    // Both parts: the ring that anchors it on the grid, and the name beside it.
    const circle = await centreOf(page, `[data-id="${id}"] .node-monogram`);
    const name = await centreOf(page, `[data-id="${id}"] strong`);
    expect(await ownerAt(page, circle), `${id}: circle covered`).toBe(id);
    expect(await ownerAt(page, name), `${id}: name covered`).toBe(id);
  }
});

test("hovering a marker lifts it above a favourite that overlaps it", async ({ page }) => {
  await openScene(page);

  // An ordinary marker that overlaps a favourite's circle, a point of it that no favourite
  // reaches (to put the pointer there) and a point inside the overlap (to look at afterwards).
  const probe = await page.evaluate((favourites) => {
    const rectOf = (element: Element) => element.getBoundingClientRect();
    const circles = favourites.map((id) => ({
      id,
      rect: rectOf(document.querySelector(`[data-id="${id}"] .node-monogram`) as Element),
    }));
    const inside = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const everyFavouritePart = favourites.flatMap((id) =>
      ["strong", ".node-monogram"].map((part) =>
        rectOf(document.querySelector(`[data-id="${id}"] ${part}`) as Element),
      ),
    );
    for (const ordinary of document.querySelectorAll<HTMLElement>('[data-id^="ort-"]')) {
      const rect = rectOf(ordinary.querySelector(".story-node") as Element);
      for (const circle of circles) {
        // Both markers are round, so the middle of the two centres is the one point that
        // is certain to lie inside both -- the corner of the boxes' overlap lies in neither.
        const centreOf = (box: DOMRect) => ({
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          radius: Math.min(box.width, box.height) / 2,
        });
        const [mine, theirs] = [centreOf(rect), centreOf(circle.rect)];
        const overlap = { x: (mine.x + theirs.x) / 2, y: (mine.y + theirs.y) / 2 };
        const reach = (centre: typeof mine) =>
          Math.hypot(overlap.x - centre.x, overlap.y - centre.y) < centre.radius * 0.85;
        if (!reach(mine) || !reach(theirs)) continue;
        const free = [
          [rect.left + 3, rect.top + rect.height / 2],
          [rect.right - 3, rect.top + rect.height / 2],
          [rect.left + rect.width / 2, rect.top + 3],
          [rect.left + rect.width / 2, rect.bottom - 3],
        ].find(
          ([x, y]) =>
            !everyFavouritePart.some((part) => inside(part, x, y)) &&
            document.elementFromPoint(x, y)?.closest<HTMLElement>(".react-flow__node")?.dataset
              .id === ordinary.dataset.id,
        );
        if (free) {
          return { ordinary: ordinary.dataset.id, favourite: circle.id, overlap, free };
        }
      }
    }
    return null;
  }, favouriteIds);
  expect(probe, "scene has no ordinary marker overlapping a favourite").not.toBeNull();
  if (!probe) return;

  expect(await ownerAt(page, probe.overlap), "before hover").toBe(probe.favourite);
  await page.mouse.move(probe.free[0], probe.free[1]);
  expect(await ownerAt(page, probe.overlap), "while hovered").toBe(probe.ordinary);
});

test("only the surface of a favourite is translucent, and it turns solid on hover", async ({
  page,
}) => {
  await openScene(page);
  const alphaOf = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      const alpha = (colour: string) => {
        const channels = colour.match(/[\d.]+/g)?.map(Number) ?? [];
        return channels.length > 3 ? (channels[3] as number) : 1;
      };
      return {
        surface: alpha(style.backgroundColor),
        text: alpha(style.color),
        border: alpha(style.borderTopColor),
      };
    });

  const resting = await alphaOf('[data-id="fav-libelle"] strong');
  expect(resting.surface).toBeCloseTo(0.88, 2);
  expect(resting.text).toBe(1);
  expect(resting.border).toBe(1);
  expect((await alphaOf('[data-id="fav-libelle"] .node-monogram')).surface).toBeCloseTo(0.88, 2);

  await page.locator('[data-id="fav-libelle"] strong').hover();
  expect((await alphaOf('[data-id="fav-libelle"] strong')).surface).toBe(1);
  expect((await alphaOf('[data-id="fav-libelle"] .node-monogram')).surface).toBe(1);
});

test("a favourite shows its whole name beside a ring-gold circle on both themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await openScene(page, theme);
    const circle = await page.locator('[data-id="fav-hafen"] .node-monogram').boundingBox();
    const name = await page.locator('[data-id="fav-hafen"] strong').boundingBox();
    if (!circle || !name) throw new Error("favourite parts have no box");
    const coarse = await page.evaluate(
      () => matchMedia("(max-width: 640px), (pointer: coarse)").matches,
    );
    // The circle is the anchor on the grid: as large as an ordinary marker, 44px to touch.
    expect(circle.width).toBeCloseTo(coarse ? 44 : 32, 0);
    expect(name.x).toBeGreaterThanOrEqual(circle.x + circle.width);
    expect(await page.locator('[data-id="fav-hafen"] strong').innerText()).toBe("Hafenmeisterei");
    const ring = await page
      .locator('[data-id="fav-hafen"] .node-monogram')
      .evaluate((element) => getComputedStyle(element).boxShadow);
    const gold = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--gold)";
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    expect(ring).toContain(gold);
  }
});
