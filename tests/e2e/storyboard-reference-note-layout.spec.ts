import type { Page } from "@playwright/test";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { exampleWorldDocuments, seedExampleWorld } from "./support/example-world";
import { putVersioned } from "./support/seed";
import { expect, test } from "./support/world-fixture";

// T-177: a reference card shows its element's note, which is often long and carries headings
// and reference marks. The note must stay inside its own area: nothing of it may cover the
// card's "Original öffnen", and that button must stay clickable.
//
// Mara's note in the test world has the headings and the references; only the card's size is
// the test's own, so the world's storyboards are stored again with her card resized.

async function seed(page: Page, height: number, width = 240) {
  const world = await seedExampleWorld(page, { open: false });
  const storyboards = exampleWorldDocuments().storyboards;
  const card = storyboards.nodes.find((node) => node.id === world.ids.cards.referenceMara);
  if (!card) throw new Error("The test world has lost Mara's reference card.");
  Object.assign(card, { width, height });
  await putVersioned(page, `/api/storyboards?world=${world.id}`, (revision) =>
    encodeStoryboardsV1(storyboards, revision),
  );
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  return page.locator(`.react-flow__node[data-id="${world.ids.cards.referenceMara}"]`);
}

for (const [label, height, width] of [
  ["a regular card", 170, 240],
  ["a narrow card", 210, 180],
  ["a short card", 120, 240],
] as const) {
  test(`the note of ${label} stays above its footer and the footer stays clickable`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "Card geometry does not depend on the viewport.");
    const card = await seed(page, height, width);
    const open = card.getByRole("button", { name: "Original öffnen" });
    await expect(open).toBeVisible();
    // The note opens with its card's title as a heading, which the card leaves out (T-185).
    await expect(card.locator(".cm-line").filter({ hasText: "Kartographin" })).toBeVisible();

    const layout = await card.evaluate((element) => {
      const note = element.querySelector<HTMLElement>(".storyboard-node__note");
      const button = element.querySelector<HTMLElement>(".storyboard-node__open");
      if (!note || !button) throw new Error("card parts missing");
      const footer = button.getBoundingClientRect();
      // Everything the note draws, marks and reference highlights included, is visible only
      // inside the boxes that clip it; what remains of it must end above the footer.
      const clipOf = (part: HTMLElement) => {
        let top = Number.NEGATIVE_INFINITY;
        let bottom = Number.POSITIVE_INFINITY;
        for (let at = part.parentElement; at && at !== element; at = at.parentElement) {
          if (getComputedStyle(at).overflowY === "visible") continue;
          const box = at.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
        return { top, bottom };
      };
      const clip = note.getBoundingClientRect();
      const drawn = [...note.querySelectorAll<HTMLElement>(".cm-line, .note-reference")]
        .map((part) => {
          const rect = part.getBoundingClientRect();
          const box = clipOf(part);
          return { top: Math.max(rect.top, box.top), bottom: Math.min(rect.bottom, box.bottom) };
        })
        .filter((rect) => rect.bottom > rect.top);
      const probes = [0.15, 0.5, 0.85].flatMap((x) =>
        [0.3, 0.7].map((y) => {
          const hit = document.elementFromPoint(
            footer.left + footer.width * x,
            footer.top + footer.height * y,
          );
          return Boolean(hit && button.contains(hit));
        }),
      );
      return {
        clipBottom: clip.bottom,
        footerTop: footer.top,
        lowestDrawn: Math.max(...drawn.map((rect) => rect.bottom)),
        overflow: getComputedStyle(note).overflow,
        probes,
      };
    });

    expect(layout.clipBottom, "the note area ends above the footer").toBeLessThanOrEqual(
      layout.footerTop + 0.5,
    );
    expect(layout.lowestDrawn, "nothing of the note is drawn over the footer").toBeLessThanOrEqual(
      layout.footerTop + 0.5,
    );
    expect(layout.overflow).toBe("hidden");
    expect(layout.probes, "the footer is clickable everywhere").toEqual(
      layout.probes.map(() => true),
    );
  });
}
