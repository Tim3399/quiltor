import {
  expect,
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

interface TestWorld {
  id: string;
  title: string;
  backupUrl: string;
  updated?: string;
}

interface WorldRegistry {
  testIds: Set<string>;
  workerIds: Set<string>;
}

interface WorldCleanupFixtures {
  worldCleanup: true;
}

interface WorldCleanupWorkerFixtures {
  pendingWorldIds: Set<string>;
}

const registries = new WeakMap<Page, WorldRegistry>();

async function deleteRegisteredWorlds(
  request: APIRequestContext,
  ids: Iterable<string>,
): Promise<string[]> {
  const failures: string[] = [];
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const response = await request.post("/api/worlds/delete", {
          data: { id },
          timeout: 10_000,
        });
        if (!response.ok() && response.status() !== 404) {
          failures.push(`${id}: HTTP ${response.status()} ${await response.text()}`);
        }
      } catch (error) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return failures;
}

export async function createTestWorld(
  page: Page,
  title = "Testwelt",
  backupUrl = "",
): Promise<TestWorld> {
  const registry = registries.get(page);
  if (!registry) {
    throw new Error("createTestWorld requires the shared E2E test fixture.");
  }

  const response = await page.request.post("/api/worlds/create", {
    data: { title, backupUrl },
    timeout: 10_000,
  });
  if (!response.ok()) {
    throw new Error(
      `World creation failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as { world?: unknown };
  if (
    typeof payload.world !== "object" ||
    payload.world === null ||
    !("id" in payload.world) ||
    typeof payload.world.id !== "string" ||
    !/^[0-9a-f]{32}$/.test(payload.world.id)
  ) {
    throw new Error("World creation returned an invalid payload.");
  }
  registry.testIds.add(payload.world.id);
  registry.workerIds.add(payload.world.id);
  if (!("title" in payload.world) || typeof payload.world.title !== "string") {
    throw new Error("World creation returned an invalid title.");
  }
  const returnedBackupUrl = "backupUrl" in payload.world ? payload.world.backupUrl : "";
  if (typeof returnedBackupUrl !== "string") {
    throw new Error("World creation returned an invalid backup URL.");
  }
  const returnedUpdated = "updated" in payload.world ? payload.world.updated : undefined;
  if (returnedUpdated !== undefined && typeof returnedUpdated !== "string") {
    throw new Error("World creation returned an invalid update timestamp.");
  }

  const world: TestWorld = {
    id: payload.world.id,
    title: payload.world.title,
    backupUrl: returnedBackupUrl,
    updated: returnedUpdated,
  };
  return world;
}

export const test = base.extend<WorldCleanupFixtures, WorldCleanupWorkerFixtures>({
  pendingWorldIds: [
    async ({}, use, workerInfo) => {
      const pendingWorldIds = new Set<string>();
      await use(pendingWorldIds);

      if (pendingWorldIds.size === 0) return;
      const configuredBaseUrl = workerInfo.project.use.baseURL;
      const baseURL =
        typeof configuredBaseUrl === "string"
          ? configuredBaseUrl
          : process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8000";
      const request = await playwrightRequest.newContext({ baseURL });
      try {
        const failures = await deleteRegisteredWorlds(request, pendingWorldIds);
        if (failures.length > 0) {
          throw new Error(`E2E world cleanup failed:\n${failures.join("\n")}`);
        }
      } finally {
        await request.dispose();
      }
    },
    { scope: "worker" },
  ],
  worldCleanup: [
    async ({ page, pendingWorldIds }, use, testInfo) => {
      const testIds = new Set<string>();
      registries.set(page, { testIds, workerIds: pendingWorldIds });

      try {
        await use(true);
      } finally {
        const failures = await deleteRegisteredWorlds(page.request, testIds);
        const failedIds = new Set(
          failures.map((failure) => failure.slice(0, failure.indexOf(":"))),
        );
        for (const id of testIds) {
          if (!failedIds.has(id)) pendingWorldIds.delete(id);
        }
        registries.delete(page);

        if (failures.length > 0) {
          await testInfo.attach("world-cleanup-errors", {
            body: Buffer.from(failures.join("\n"), "utf8"),
            contentType: "text/plain",
          });
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
