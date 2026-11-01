import type { Page } from "@playwright/test";
import { expect, test } from "./support/transient-network";
import { mockRequiredWorldDocuments } from "./support/application-api";

/*
 * On a phone the app bar holds the five workspace tabs and the assistant button side by
 * side. They must all fit: a tab hidden under the assistant button is a workspace the
 * author cannot reach.
 */

const world = {
  id: "mobile-tabs",
  title: "Der gläserne Atlas",
  backupUrl: "",
  updated: "2026-09-03T12:00:00Z",
};

async function openWorld(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "mobile-tabs" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await mockRequiredWorldDocuments(page, {
    manuscript: {
      chapters: [{ id: "c1", title: "Die Ankunft", body: "Der Morgen lag still.", note: "" }],
      words: [],
      activeSymbols: [],
    },
    storyWorld: {
      nodes: [{ id: "mara", x: 120, y: 120, type: "person", name: "Mara Venn" }],
      edges: [],
    },
  });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "-", chunks: 0 },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
}

const targets = [
  "Text",
  "Figuren",
  "Timeline",
  "Orte",
  "Storyboard",
  "Lokalen Assistenten öffnen",
] as const;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test.describe(`${viewport.width}x${viewport.height} touch`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("all workspace tabs and the assistant button are visible and hit-testable", async ({
      page,
    }) => {
      await openWorld(page);
      const report = await page.evaluate((labels) => {
        const problems: string[] = [];
        const boxes = labels.map((label) => {
          const element = document.querySelector(`.app-bar button[aria-label="${label}"]`);
          if (!element) {
            problems.push(`${label}: missing`);
            return null;
          }
          return { label, element, rect: element.getBoundingClientRect() };
        });
        const present = boxes.filter((entry) => entry !== null);
        for (const { label, element, rect } of present) {
          if (rect.width < 1 || rect.height < 1) problems.push(`${label}: empty box`);
          if (
            rect.left < 0 ||
            rect.top < 0 ||
            rect.right > window.innerWidth ||
            rect.bottom > window.innerHeight
          ) {
            problems.push(`${label}: outside the viewport (${rect.left}-${rect.right})`);
          }
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          if (!hit || !element.contains(hit)) {
            problems.push(
              `${label}: centre hits ${hit?.getAttribute("aria-label") ?? hit?.tagName}`,
            );
          }
        }
        for (let i = 0; i < present.length; i += 1) {
          for (let j = i + 1; j < present.length; j += 1) {
            const a = present[i].rect;
            const b = present[j].rect;
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 0.5 && overlapY > 0.5) {
              problems.push(`${present[i].label} overlaps ${present[j].label}`);
            }
          }
        }
        return problems;
      }, targets);
      expect(report, "app bar targets").toEqual([]);
    });
  });
}
