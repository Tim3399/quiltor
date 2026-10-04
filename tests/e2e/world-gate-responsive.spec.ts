import { expect, test } from "@playwright/test";

const scenarios = [
  { width: 319, height: 884, count: 10, enlarged: false },
  { width: 320, height: 568, count: 10, enlarged: false },
  { width: 390, height: 844, count: 10, enlarged: false },
  { width: 483, height: 884, count: 10, enlarged: false },
  { width: 719, height: 800, count: 10, enlarged: false },
  { width: 900, height: 760, count: 10, enlarged: false },
  { width: 320, height: 844, count: 0, enlarged: false },
  { width: 320, height: 844, count: 10, enlarged: true },
];

for (const theme of ["light", "dark"] as const) {
  test(`World picker actions and catalog remain reachable in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "wide",
      "This test owns its viewport and text-size matrix.",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    let worldCount = 10;
    await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
    await page.route("**/api/worlds", (route) =>
      route.fulfill({
        json: {
          ok: true,
          worlds: Array.from({ length: worldCount }, (_, index) => ({
            id: `responsive-${index + 1}`,
            title: `Chronik ${index + 1} mit einem längeren Weltnamen`,
            backupUrl: "",
            updated: "2026-08-09T12:00:00Z",
          })),
        },
      }),
    );

    for (const scenario of scenarios) {
      await test.step(`${scenario.width}x${scenario.height}, ${scenario.count} worlds, text ${scenario.enlarged ? 200 : 100}%`, async () => {
        worldCount = scenario.count;
        await page.setViewportSize({ width: scenario.width, height: scenario.height });
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        if (scenario.enlarged) {
          await page.evaluate(() => {
            const elements = [
              ...document.querySelectorAll<HTMLElement>(".world-gate, .world-gate *"),
            ];
            const sizes = elements.map((element) =>
              Number.parseFloat(getComputedStyle(element).fontSize),
            );
            elements.forEach((element, index) => {
              element.style.fontSize = `${sizes[index] * 2}px`;
            });
          });
        }

        const header = page.locator(".world-list-panel > header");
        const actions = header.getByRole("button");
        await expect(actions).toHaveCount(4);
        const geometry = await header.evaluate((element) => {
          const panel = element.parentElement!.getBoundingClientRect();
          const heading = element.querySelector("h2")!.getBoundingClientRect();
          return {
            panel: { left: panel.left, right: panel.right },
            headingBottom: heading.bottom,
            actions: [...element.querySelectorAll("button")].map((button) => {
              const rect = button.getBoundingClientRect();
              const label = button.querySelector(".ui-button__label")!;
              return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                height: rect.height,
                clippedLabel: label.scrollWidth > label.clientWidth + 1,
              };
            }),
          };
        });
        for (const action of geometry.actions) {
          expect(action.left).toBeGreaterThanOrEqual(geometry.panel.left);
          expect(action.right).toBeLessThanOrEqual(geometry.panel.right);
          expect(action.clippedLabel).toBe(false);
          if (scenario.width <= 719) {
            expect(action.height).toBeGreaterThanOrEqual(44);
            expect(action.top).toBeGreaterThanOrEqual(geometry.headingBottom);
          }
        }
        if (scenario.width <= 719 && !scenario.enlarged) {
          expect(geometry.actions[0].top).toBe(geometry.actions[1].top);
          expect(geometry.actions[2].top).toBe(geometry.actions[3].top);
          expect(geometry.actions[2].top).toBeGreaterThan(geometry.actions[0].top);
        }
        for (const action of await actions.all()) {
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeInViewport();
        }
        if (scenario.count) {
          const lastWorld = page.getByRole("button", {
            name: `Chronik ${scenario.count} mit einem längeren Weltnamen – Welt öffnen`,
            exact: true,
          });
          await lastWorld.scrollIntoViewIfNeeded();
          await expect(lastWorld).toBeInViewport();
        }
      });
    }
  });
}
