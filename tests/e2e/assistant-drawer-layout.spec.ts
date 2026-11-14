import type { Page } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-275: with the engine switch on top, the world update landed in the drawer's growing grid
// row and its button and scope select grew into 180 px tiles with a cut label. The switch
// appears whenever a second engine is on offer; the test profile's slot (testHooks) supplies
// that second engine here, since the suite's browser has no WebGPU for the in-browser one.

async function offerTwoEngines(page: Page, { multiUser = false, serverAi = true } = {}) {
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        instance: {
          ...body.instance,
          multiUser,
          assistantInstall: !multiUser,
          clientAi: true,
          testHooks: true,
        },
        user: { ...body.user, serverAi },
      },
    });
  });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: true, mode: "local", reason: "", chunks: 0, premium: true },
    }),
  );
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("radiogroup", { name: "KI-Engine" })).toBeVisible();
  return drawer;
}

test("the world update keeps control heights and its whole label beside the engine switch", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await offerTwoEngines(page);
  await createTestWorld(page, "Assistent-Knöpfe");
  const drawer = await openAssistant(page);

  const update = drawer.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" });
  const scope = drawer.getByRole("combobox", { name: "Manuskriptbereich" });
  const metrics = await page.evaluate(
    ([updateHandle, scopeHandle]) => {
      const control = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--control-regular"),
      );
      const measure = (element: Element) => {
        const box = element.getBoundingClientRect();
        const label =
          element.querySelector(".ui-button__label, .ui-select-option__label") ?? element;
        return {
          height: box.height,
          cut: label.scrollWidth > label.clientWidth + 1,
          left: box.left,
          right: box.right,
        };
      };
      const section = updateHandle?.closest("section")?.getBoundingClientRect();
      return {
        control,
        update: updateHandle ? measure(updateHandle) : null,
        scope: scopeHandle ? measure(scopeHandle) : null,
        section: section ? { left: section.left, right: section.right } : null,
      };
    },
    [await update.elementHandle(), await scope.elementHandle()] as const,
  );
  await testInfo.attach("assistant-drawer", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });

  expect(metrics.control).toBeGreaterThan(0);
  for (const part of [metrics.update, metrics.scope]) {
    expect(part).not.toBeNull();
    expect(part?.height).toBeLessThanOrEqual(metrics.control + 1);
    expect(part?.cut).toBe(false);
    expect(part?.left).toBeGreaterThanOrEqual((metrics.section?.left ?? 0) - 0.5);
    expect(part?.right).toBeLessThanOrEqual((metrics.section?.right ?? 0) + 0.5);
  }
  await expect(drawer.getByText("Auf diesem Rechner · nur Vorschläge")).toBeVisible();
  await expect(drawer.getByRole("radio", { name: "Auf diesem Rechner" })).toBeChecked();
});

test("without the premium role the server AI is shown locked and the header names the own engine", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await offerTwoEngines(page, { multiUser: true, serverAi: false });
  await createTestWorld(page, "Assistent ohne Premium");
  const drawer = await openAssistant(page);
  await expect(drawer.getByRole("radio", { name: "Server-KI" })).toBeDisabled();
  await expect(
    drawer.getByText("Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung."),
  ).toBeVisible();
  await expect(drawer.getByText("Server-KI · nur Vorschläge")).toHaveCount(0);
  await testInfo.attach("assistant-drawer-locked", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });
});
