import type { Page } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-275: the drawer laid its parts out on fixed grid rows. Anything the status added above the
// world update -- the engine switch, an engine panel, a notice -- pushed it into the growing row,
// and its button and scope select grew into 180 px tiles with a cut label. A hosted server shows
// the switch (D-205, Nachtrag 3); the test profile's slot (testHooks) is the browser engine
// here, since the suite's browser has no WebGPU for the real one.

async function capabilities(page: Page, { hosted = false, serverAi = true } = {}) {
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        instance: hosted
          ? { ...body.instance, assistantInstall: false, clientAi: true, testHooks: true }
          : body.instance,
        user: { ...body.user, serverAi },
      },
    });
  });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: true, mode: "local", reason: "", chunks: 0, premium: serverAi },
    }),
  );
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function expectControlsAtControlHeight(page: Page) {
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
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
  expect(metrics.control).toBeGreaterThan(0);
  for (const part of [metrics.update, metrics.scope]) {
    expect(part).not.toBeNull();
    expect(part?.height).toBeLessThanOrEqual(metrics.control + 1);
    expect(part?.cut).toBe(false);
    expect(part?.left).toBeGreaterThanOrEqual((metrics.section?.left ?? 0) - 0.5);
    expect(part?.right).toBeLessThanOrEqual((metrics.section?.right ?? 0) + 0.5);
  }
}

test("on a computer of one's own the drawer names it and shows no switch", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await capabilities(page);
  await createTestWorld(page, "Assistent auf diesem Rechner");
  const drawer = await openAssistant(page);
  await expect(drawer.getByText("Auf diesem Rechner · nur Vorschläge")).toBeVisible();
  await expect(drawer.getByRole("radiogroup", { name: "KI-Engine" })).toHaveCount(0);
  await expectControlsAtControlHeight(page);
  await testInfo.attach("assistant-drawer-local", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });
});

test("hosted with the premium role the switch offers both and the controls keep their height", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await capabilities(page, { hosted: true, serverAi: true });
  await createTestWorld(page, "Assistent mit Premium");
  const drawer = await openAssistant(page);
  await expect(drawer.getByRole("radio", { name: "Server-KI" })).toBeChecked();
  await expect(drawer.getByText("Server-KI · nur Vorschläge")).toBeVisible();
  await drawer.getByRole("radio", { name: "Eigener Schlüssel" }).check();
  await expect(drawer.getByText("Eigener Schlüssel · nur Vorschläge")).toBeVisible();
  await expectControlsAtControlHeight(page);
  await testInfo.attach("assistant-drawer-premium", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });
});

test("hosted without the premium role the server AI is greyed out with its reason", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await capabilities(page, { hosted: true, serverAi: false });
  await createTestWorld(page, "Assistent ohne Premium");
  const drawer = await openAssistant(page);
  await expect(drawer.getByText("Eigener Schlüssel · nur Vorschläge")).toBeVisible();
  await expect(
    drawer.getByText("Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung."),
  ).toBeVisible();
  const choice = drawer.getByRole("radiogroup", { name: "KI-Engine" });
  await expect(choice.getByRole("radio", { name: "Server-KI" })).toBeDisabled();
  await expect(choice).toHaveAccessibleDescription(
    "Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.",
  );
  await expectControlsAtControlHeight(page);
  await testInfo.attach("assistant-drawer-no-premium", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });
});
