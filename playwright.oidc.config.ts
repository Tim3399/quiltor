import { defineConfig, devices } from "@playwright/test";

// Browser tests that need a signed-in OIDC session (T-58 P7b). Their own directory and config:
// the product suite (playwright.config.ts, tests/e2e) runs in local mode, where these tests
// would fail. tests/e2e-oidc/support/oidc_stack.py starts a fake Keycloak and Quiltor on fixed
// loopback ports -- never 8010 or 8000 -- with a fresh data directory of its own.
const port = Number(process.env.QUILTOR_OIDC_E2E_PORT || 8035);
const issuerPort = Number(process.env.QUILTOR_OIDC_E2E_ISSUER_PORT || 8036);

export default defineConfig({
  testDir: "./tests/e2e-oidc",
  // One stack, one fake account: tests share its sessions, so they run one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "oidc-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `node tools/dev/python.mjs --needs jwt tests/e2e-oidc/support/oidc_stack.py --port ${port} --issuer-port ${issuerPort}`,
    url: `http://127.0.0.1:${port}/`,
    // Never reuse: a server already on the port belongs to someone else and has no fake issuer.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
