import { expect, type Page, test } from "@playwright/test";

const favouriteIds = ["fav-libelle", "fav-hafen", "fav-mole"];

async function openScene(page: Page, theme: "light" | "dark" = "light") {
  await page.goto(`/?scene=story-node-favourites&theme=${theme}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(46);
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
    // The name has an element of its own: the ellipsis only works on a block container, and
    // the strong around it is a flex box that also holds a symbol. As flex text the name was
    // cut hard, in the middle of a letter, whatever `text-overflow` said.
    const cut = await pill.locator(".node-name").evaluate((element) => ({
      display: getComputedStyle(element).display,
      textOverflow: getComputedStyle(element).textOverflow,
      truncated: element.scrollWidth > element.clientWidth,
      title: element.closest("strong")?.getAttribute("title"),
    }));
    expect(cut.truncated, `${theme}: the name fits, so nothing is tested`).toBe(true);
    expect(cut.display).not.toBe("inline");
    expect(cut.textOverflow).toBe("ellipsis");
    expect(cut.title).toBe("Die nördliche Hafenmeisterei am äußersten Kai der Gezeitenbucht");
    expect((await pill.boundingBox())?.width).toBeLessThanOrEqual(140);
  }
});

test("a long name is cut with an ellipsis in the compact and detail tiers too", async ({
  page,
}) => {
  await openScene(page);
  for (const tier of ["compact", "detail"] as const) {
    // The same node, put into the other tier: the rule under test is the tier's CSS.
    const cut = await page.locator('[data-id="fav-lang"] .story-node').evaluate((element, next) => {
      element.classList.remove("zoom-overview", "zoom-compact", "zoom-detail");
      element.classList.add(`zoom-${next}`);
      element.style.setProperty("--node-compact-width", "98px");
      element.style.setProperty("--node-compact-height", "33px");
      const name = element.querySelector<HTMLElement>(".node-name") as HTMLElement;
      return {
        textOverflow: getComputedStyle(name).textOverflow,
        truncated: name.scrollWidth > name.clientWidth,
      };
    }, tier);
    // Without its own ellipsis rule the name is flex text: no ellipsis, and no box of its own
    // to overflow either, so it is cut hard at the node's edge.
    expect(cut.textOverflow, tier).toBe("ellipsis");
    expect(cut.truncated, `${tier}: the name fits, so nothing is tested`).toBe(true);
  }
});

test("a symbol beside a name that has to be cut stays whole, centred and apart from it", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await openScene(page, theme);
    for (const id of ["fav-tot", "fav-pin"]) {
      const pill = page.locator(`[data-id="${id}"] .story-node`);
      const probe = await pill.evaluate((pillElement) => {
        const strong = pillElement.querySelector("strong") as HTMLElement;
        const symbol = strong.querySelector("svg") as SVGElement;
        const name = strong.querySelector<HTMLElement>(".node-name");
        const rect = (element: Element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return { left, right, top, bottom };
        };
        const symbolBox = rect(symbol);
        const owner = document.elementFromPoint(
          (symbolBox.left + symbolBox.right) / 2,
          (symbolBox.top + symbolBox.bottom) / 2,
        );
        return {
          pill: rect(pillElement),
          symbol: symbolBox,
          name: name ? rect(name) : null,
          nameCut: name ? name.scrollWidth > name.clientWidth : null,
          nameOverflow: name ? getComputedStyle(name).textOverflow : null,
          title: strong.getAttribute("title"),
          symbolOnTop: !!owner && (owner === symbol || symbol.contains(owner)),
        };
      });
      const label = `${theme} ${id}`;
      expect(probe.symbolOnTop, `${label}: the symbol is hidden or clipped`).toBe(true);
      // Whole inside the pill, borders included.
      expect(probe.symbol.left, label).toBeGreaterThanOrEqual(probe.pill.left + 2);
      expect(probe.symbol.right, label).toBeLessThanOrEqual(probe.pill.right - 2);
      // Centred on the pill's height, not left on the text's baseline.
      const centre = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2;
      expect(Math.abs(centre(probe.symbol) - centre(probe.pill)), label).toBeLessThanOrEqual(1.5);
      // The name -- not the symbol -- is what gets cut, and it keeps a gap to the symbol.
      expect(probe.name, `${label}: the name has no element of its own`).not.toBeNull();
      expect(probe.nameCut, `${label}: nothing is cut`).toBe(true);
      expect(probe.nameOverflow, label).toBe("ellipsis");
      expect(probe.name?.right ?? Number.POSITIVE_INFINITY, label).toBeLessThanOrEqual(
        probe.symbol.left - 2,
      );
      expect(probe.title, label).toMatch(/\S{3,}/);
    }
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
