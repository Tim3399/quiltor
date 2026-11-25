import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

/**
 * The product config, pointed at a hosted container (T-364). The container's identity is a
 * local one: the stage sends its token as a bearer header with every request of the browser
 * and of `page.request`, which is what the product suites would otherwise get from the
 * loopback trust of the source server. Everything else is the product's own config.
 */
export default defineConfig({
  ...base,
  testDir: resolve(import.meta.dirname, "../../tests/e2e"),
  use: {
    ...base.use,
    extraHTTPHeaders: process.env.QUILTOR_STAGE_TOKEN
      ? { Authorization: `Bearer ${process.env.QUILTOR_STAGE_TOKEN}` }
      : {},
  },
});
