import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";

const auditViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "narrow", width: 720, height: 800 },
  { name: "touch", width: 390, height: 844 },
] as const;

const auditThemes = ["light", "dark"] as const;
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const manuscript = {
  chapters: [
    {
      id: "audit-chapter",
      title: "Der Audit beginnt",
      body: "Mara betritt den Hafen und sucht das Gezeitenarchiv.",
      note: "Ein deterministisches Kapitel für den Produktvertrag.",
    },
  ],
  words: [],
  zeichenAktiv: ["„", "“", "…"],
};

const storyWorld = {
  nodes: [
    {
      id: "mara",
      x: 120,
      y: 120,
      type: "person" as const,
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest lebende Karten.",
    },
    {
      id: "archiv",
      x: 480,
      y: 260,
      type: "ort" as const,
      name: "Gezeitenarchiv",
      label: "Ort",
      sub: "Ein gläserner Bau am Hafen.",
      mapX: 35,
      mapY: 45,
    },
  ],
  edges: [{ id: "audit-edge", from: "mara", to: "archiv", label: "sucht", gerichtet: true }],
  timeline: [
    {
      id: "audit-moment",
      title: "Ankunft",
      date: "1847-09-03",
      note: "Mara erreicht den Hafen.",
    },
  ],
  presence: [],
};

async function mockAuditWorld(page: Page) {
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "design-product-matrix" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  await page.route("**/api/worlds", (route) =>
    route.fulfill({
      json: {
        ok: true,
        worlds: [
          {
            id: "design-product-matrix",
            title: "Design-Auditwelt",
            backupUrl: "",
            updated: "2026-08-26T10:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/worlds/open", (route) =>
    route.fulfill({
      json: {
        ok: true,
        world: {
          id: "design-product-matrix",
          title: "Design-Auditwelt",
          backupUrl: "",
          updated: "2026-08-26T10:00:00Z",
        },
      },
    }),
  );
  await mockRequiredWorldDocuments(page, { manuscript, storyWorld });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        available: false,
        mode: "local",
        reason: "Design-Produktmatrix",
        chunks: 3,
      },
    }),
  );
}

async function expectNoDocumentOverflow(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0),
    };
  });
  expect(geometry.scrollWidth, `${label} verbreitert das Dokument`).toBeLessThanOrEqual(
    geometry.clientWidth + 1,
  );
}

async function expectTouchTargets(page: Page, label: string) {
  const selector = [
    "a[href]:visible",
    "button:visible",
    "input:visible",
    "select:visible",
    "textarea:visible",
    "summary:visible",
    '[role="button"]:visible',
    '[role="link"]:visible',
    '[role="radio"]:visible',
  ].join(", ");
  const undersized = await page.locator(selector).evaluateAll((controls) =>
    [...new Set(controls)].flatMap((control) => {
      if (
        control.closest('[aria-hidden="true"], [inert]') ||
        control.getAttribute("aria-disabled") === "true" ||
        (control instanceof HTMLButtonElement && control.disabled) ||
        (control instanceof HTMLInputElement && control.disabled) ||
        (control instanceof HTMLSelectElement && control.disabled) ||
        (control instanceof HTMLTextAreaElement && control.disabled)
      ) {
        return [];
      }
      const wrappingLabel =
        control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)
          ? control.closest("label")
          : null;
      const hitTarget = wrappingLabel ?? control;
      const box = hitTarget.getBoundingClientRect();
      if (box.width + 0.5 >= 44 && box.height + 0.5 >= 44) return [];
      return [
        `${control.tagName.toLowerCase()}[${control.getAttribute("aria-label") ?? control.textContent?.trim() ?? ""}] ${Math.round(box.width)}x${Math.round(box.height)}`,
      ];
    }),
  );
  expect(undersized, `${label} enthält sichtbare Touchziele unter 44px`).toEqual([]);
}

async function expectWorkspaceContract(
  page: Page,
  marker: Locator,
  label: string,
  pageErrors: Error[],
  touch: boolean,
) {
  await expect(marker, `${label}: Kerninhalt ist nicht sichtbar`).toBeVisible();
  await expect(
    page.locator("main.app-workspace"),
    `${label}: App-Main ist nicht sichtbar`,
  ).toBeVisible();
  await expectNoDocumentOverflow(page, label);
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  expect(results.violations, `${label}: Axe A/AA`).toEqual([]);
  if (touch) await expectTouchTargets(page, label);
  expect(
    pageErrors.splice(0).map((error) => error.stack ?? error.message),
    `${label}: unerwarteter pageerror`,
  ).toEqual([]);
}

test("Produktmatrix hält Theme-, Viewport-, Layout-, Touch- und A11y-Verträge", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Produktmatrix setzt alle Audit-Viewports selbst und läuft deshalb nur einmal.",
  );
  test.setTimeout(180_000);

  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await mockAuditWorld(page);
  await page.goto("/");

  for (const theme of auditThemes) {
    for (const viewport of auditViewports) {
      const scenario = `${theme} ${viewport.width}x${viewport.height}`;
      await test.step(scenario, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.evaluate((selectedTheme) => {
          localStorage.setItem("quiltor-theme", selectedTheme);
          localStorage.setItem("quiltor-interface-language", "de");
        }, theme);
        await page.goto("/?world=design-product-matrix");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        const touch = viewport.name === "touch";
        await test.step("Manuskript", async () => {
          await expectWorkspaceContract(
            page,
            page.getByLabel("Kapiteltext"),
            `${scenario} / Manuskript`,
            pageErrors,
            touch,
          );
        });

        await test.step("Figuren", async () => {
          await page.getByRole("button", { name: "Figuren", exact: true }).click();
          await expectWorkspaceContract(
            page,
            page.getByLabel("Figuren und Beziehungen"),
            `${scenario} / Figuren`,
            pageErrors,
            touch,
          );
        });

        await test.step("Timeline", async () => {
          await page.getByRole("button", { name: "Timeline", exact: true }).click();
          await expectWorkspaceContract(
            page,
            page.getByRole("region", { name: "Timeline" }),
            `${scenario} / Timeline`,
            pageErrors,
            touch,
          );
        });

        await test.step("Orte", async () => {
          await page.getByRole("button", { name: "Orte", exact: true }).click();
          await expectWorkspaceContract(
            page,
            page.locator(".places-workspace"),
            `${scenario} / Orte`,
            pageErrors,
            touch,
          );
        });
      });
    }
  }
});
