import type { Locator, Page, TestInfo } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

// D-T-275-F1: the switch as a hosted product server shows it -- no test-hook slot, so the
// in-browser engine is the only browser engine. The suite's Chromium has no WebGPU; an init
// script stands in a hardware adapter where the case needs one, or removes navigator.gpu.

const LOCKED = "Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.";
const NO_WEBGPU =
  "Die KI im Browser braucht WebGPU, und dieser Browser bietet es nicht an. Ein aktueller Browser mit WebGPU auf einem Gerät mit Grafikchip kann es.";

async function hosted(page: Page, { serverAi, webgpu }: { serverAi: boolean; webgpu: boolean }) {
  await page.addInitScript((hardware) => {
    if (!hardware) {
      Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
      return;
    }
    const adapter = { info: { vendor: "nvidia", architecture: "ada", description: "" } };
    Object.defineProperty(Navigator.prototype, "gpu", {
      get: () => ({ requestAdapter: async () => adapter }),
    });
  }, webgpu);
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        instance: { ...body.instance, assistantInstall: false, clientAi: true, testHooks: false },
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

async function shoot(drawer: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await drawer.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function openAssistant(page: Page, name: string) {
  const world = await createTestWorld(page, name);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("hosted with the premium role and WebGPU: server AI and in the browser", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await hosted(page, { serverAi: true, webgpu: true });
  const drawer = await openAssistant(page, "Gehostet mit Premium");
  const choice = drawer.getByRole("radiogroup", { name: "KI-Engine" });
  await expect(choice.getByRole("radio", { name: "Server-KI" })).toBeChecked();
  await expect(choice.getByRole("radio", { name: "Im Browser" })).toBeEnabled();
  await expect(drawer.getByText("Eigener Schlüssel")).toHaveCount(0);
  await shoot(drawer, testInfo, "product-premium-webgpu");
});

test("hosted without the premium role, with WebGPU: the browser engine runs", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await hosted(page, { serverAi: false, webgpu: true });
  const drawer = await openAssistant(page, "Gehostet ohne Premium");
  const choice = drawer.getByRole("radiogroup", { name: "KI-Engine" });
  await expect(choice.getByRole("radio", { name: "Im Browser" })).toBeChecked();
  await expect(choice.getByRole("radio", { name: "Server-KI" })).toBeDisabled();
  await expect(choice).toHaveAccessibleDescription(LOCKED);
  await expect(drawer.getByText("Im Browser · nur Vorschläge")).toBeVisible();
  await expect(drawer.getByText("Eigener Schlüssel")).toHaveCount(0);
  await shoot(drawer, testInfo, "product-no-premium-webgpu");
});

test("hosted without the premium role and without WebGPU: both reasons, composer locked", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The drawer is a side panel only when wide.");
  await hosted(page, { serverAi: false, webgpu: false });
  const drawer = await openAssistant(page, "Gehostet ohne WebGPU");
  await shoot(drawer, testInfo, "product-no-premium-no-webgpu");
  const choice = drawer.getByRole("radiogroup", { name: "KI-Engine" });
  await expect(choice.getByRole("radio", { name: "Server-KI" })).toBeDisabled();
  await expect(choice).toHaveAccessibleDescription(`${LOCKED} ${NO_WEBGPU}`);
  await expect(drawer.getByText(NO_WEBGPU)).toBeVisible();
  await expect(drawer.getByText("Keine KI verfügbar")).toBeVisible();
  await expect(
    drawer.getByText(
      "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
    ),
  ).toHaveCount(0);
  await expect(drawer.getByRole("textbox")).toBeDisabled();
});
