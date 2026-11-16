// Warms the design gallery's Vite server once, before the first design test (T-170).
//
// The design suite starts its gallery itself and never reuses one (playwright.design.config.ts),
// so a warm-up step in the workflow could not reach it. Playwright starts the webServer before
// globalSetup, which is the one place left. The cold start that cost the visual-baseline run
// 30 s on windows-2025 (T-169) would otherwise land on whichever test happens to come first.
//
// Fails closed like tools/dev/warm-vite.mjs: a server that never gets warm stops the run
// before any test. Runs in CI only; a local gallery is warm after the first test anyway.

import { warmViteServer } from "../../tools/dev/warm-vite.mjs";

export const WARM_TIMEOUT_MS = 120_000;

export function shouldWarm(env = process.env) {
  return Boolean(env.CI) && env.QUILTOR_DESIGN_WARM !== "0";
}

export default async function warmGallery(config, { warm = warmViteServer, env } = {}) {
  if (!shouldWarm(env)) return;
  const url = config.projects[0]?.use?.baseURL;
  if (!url) throw new Error("the design config names no baseURL to warm");
  await warm({ url, timeoutMs: WARM_TIMEOUT_MS });
}
