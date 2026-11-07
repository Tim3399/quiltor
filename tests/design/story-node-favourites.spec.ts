import { expect, type Page, test } from "@playwright/test";

const favouriteIds = ["fav-libelle", "fav-hafen", "fav-mole"];

async function openScene(page: Page, theme: "light" | "dark" = "light") {
  await page.goto(`/?scene=story-node-favourites&theme=${theme}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(44);
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
    const middle = await centreOf(page, `[data-id="${id}"] .story-node`);
    expect(await ownerAt(page, middle), `${id}: covered`).toBe(id);
  }
});

test("hovering a marker lifts it above a favourite that overlaps it", async ({ page }) => {
  await openScene(page);

  // An ordinary marker that overlaps a favourite, a point of it that no favourite reaches (to
  // put the pointer there) and a point inside the overlap (to look at afterwards).
  const probe = await page.evaluate((favourites) => {
    const rectOf = (element: Element) => element.getBoundingClientRect();
    const pills = favourites.map((id) => ({
      id,
      rect: rectOf(document.querySelector(`[data-id="${id}"] .story-node`) as Element),
    }));
    const inside = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    for (const ordinary of document.querySelectorAll<HTMLElement>('[data-id^="ort-"]')) {
      const rect = rectOf(ordinary.querySelector(".story-node") as Element);
      const radius = Math.min(rect.width, rect.height) / 2;
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      for (const pill of pills) {
        // The middle of the pill's box and the marker's centre: inside both shapes when the
        // marker's centre lies within the pill and the marker's own disc reaches it.
        const overlap = {
          x: Math.min(Math.max(centre.x, pill.rect.left + 4), pill.rect.right - 4),
          y: pill.rect.top + pill.rect.height / 2,
        };
        if (Math.hypot(overlap.x - centre.x, overlap.y - centre.y) > radius * 0.7) continue;
        if (!inside(pill.rect, overlap.x, overlap.y)) continue;
        const free = [
          [rect.left + 3, centre.y],
          [rect.right - 3, centre.y],
          [centre.x, rect.top + 3],
          [centre.x, rect.bottom - 3],
        ].find(
          ([x, y]) =>
            !pills.some((other) => inside(other.rect, x, y)) &&
            document.elementFromPoint(x, y)?.closest<HTMLElement>(".react-flow__node")?.dataset
              .id === ordinary.dataset.id,
        );
        if (free) return { ordinary: ordinary.dataset.id, favourite: pill.id, overlap, free };
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
      const name = element.querySelector("strong");
      return {
        surface: alpha(style.backgroundColor),
        text: alpha(name ? getComputedStyle(name).color : style.color),
        border: alpha(style.borderTopColor),
      };
    });
  const pill = '[data-id="fav-libelle"] .story-node';

  const resting = await alphaOf(pill);
  expect(resting.surface).toBeCloseTo(0.88, 2);
  expect(resting.text).toBe(1);
  expect(resting.border).toBe(1);

  await page.locator(pill).hover();
  expect((await alphaOf(pill)).surface).toBe(1);
});

test("a name too long for its pill is cut with an ellipsis and stays whole in the tooltip", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await openScene(page, theme);
    const pill = page.locator('[data-id="fav-lang"] .story-node');
    const name = pill.locator("strong");
    // The ellipsis only works on a block container: on a flex box the text is cut hard,
    // in the middle of a letter, whatever `text-overflow` says.
    const cut = await name.evaluate((element) => ({
      display: getComputedStyle(element).display,
      textOverflow: getComputedStyle(element).textOverflow,
      truncated: element.scrollWidth > element.clientWidth,
      title: element.getAttribute("title"),
    }));
    expect(cut.truncated, `${theme}: the name fits, so nothing is tested`).toBe(true);
    expect(cut.display).toBe("block");
    expect(cut.textOverflow).toBe("ellipsis");
    expect(cut.title).toBe("Die nördliche Hafenmeisterei am äußersten Kai der Gezeitenbucht");
    expect((await pill.boundingBox())?.width).toBeLessThanOrEqual(140);
  }
});

test("a favourite is a gold-bordered pill holding its whole name, on both themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await openScene(page, theme);
    const pill = page.locator('[data-id="fav-hafen"] .story-node');
    const box = await pill.boundingBox();
    if (!box) throw new Error("favourite has no box");
    const coarse = await page.evaluate(
      () => matchMedia("(max-width: 640px), (pointer: coarse)").matches,
    );
    // As tall as an ordinary marker: 32px, 44px to touch.
    expect(box.height).toBeCloseTo(coarse ? 44 : 32, 0);
    const name = pill.locator("strong");
    expect(await name.innerText()).toBe("Hafenmeisterei");
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const gold = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--gold)";
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    expect(await pill.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(gold);
  }
});
