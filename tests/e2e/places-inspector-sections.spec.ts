import type {
  FigureNode,
  PresenceEntry,
} from "../../packages/client/src/modules/story-world/model";
import { encodeStoryWorldDocument } from "./support/application-api";
import { putVersioned } from "./support/seed";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-121: in a scroll area the inspector's sections are flex items with `overflow: hidden`,
// so without `flex: none` they shrink to fit instead of letting the body scroll. The audit
// found "Wer war hier" and "Chronik" squeezed to about 38 px, the description line cut off.

const harbour: FigureNode = { id: "harbour", type: "ort", name: "Hafen", x: 80, y: 80 };
const figures: FigureNode[] = Array.from({ length: 10 }, (_, index) => ({
  id: `figure-${index}`,
  type: "person",
  name: `Figur ${index + 1}`,
  x: 400 + index * 10,
  y: 400,
}));
const presence: PresenceEntry[] = figures.map((figure) => ({
  id: `presence-${figure.id}`,
  elementId: figure.id,
  placeId: harbour.id,
}));

test("place inspector sections keep their full height instead of shrinking", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
  const world = await createTestWorld(page, `Orte-Inspector ${testInfo.project.name}`);
  await putVersioned(page, `/api/state?world=${world.id}`, (revision) =>
    encodeStoryWorldDocument(
      { nodes: [harbour, ...figures], edges: [], timeline: [], presence },
      revision,
    ),
  );
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page
    .locator(`.react-flow__node[data-id="${harbour.id}"] .story-node`)
    .click({ position: { x: 12, y: 12 } });
  const inspector = page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true });
  await expect(inspector).toBeVisible();

  const sections = inspector.locator(".places-manager-section");
  await expect(sections).toHaveCount(2);
  for (const section of await sections.all()) {
    const box = await section.evaluate((element) => {
      const description = element.querySelector(".places-section-heading p");
      const outer = element.getBoundingClientRect();
      const line = description?.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        descriptionInside: line ? line.bottom <= outer.bottom + 0.5 : false,
      };
    });
    expect(box.scrollHeight, "section content is clipped").toBeLessThanOrEqual(
      box.clientHeight + 1,
    );
    expect(box.descriptionInside, "description line is cut off").toBe(true);
  }
});
