import type { Page } from "@playwright/test";
import type { Manuscript } from "../../../packages/client/src/modules/manuscript";
import { encodeManuscriptV1 } from "../../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, type TestWorld } from "./world-fixture";

/**
 * Replace one versioned world document (manuscript, state, storyboards) through the HTTP API.
 * Reads the current revision from the ETag and writes with If-Match, so it works on fresh and
 * already edited worlds alike.
 */
export async function putVersioned(
  page: Page,
  path: string,
  encode: (revision: number) => unknown,
  options: { timeout?: number } = {},
): Promise<void> {
  const current = await page.request.get(path);
  expect(current.ok(), await current.text()).toBe(true);
  const etag = current.headers().etag ?? '"0"';
  const revision = Number(etag.replaceAll('"', ""));
  const saved = await page.request.put(path, {
    headers: { "If-Match": `"${revision}"` },
    data: encode(revision),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/** Create a test world, store the given manuscript in it, and by default open it in the editor. */
export async function seedManuscriptWorld(
  page: Page,
  title: string,
  manuscript: Manuscript,
  options: { open?: boolean; timeout?: number } = {},
): Promise<TestWorld> {
  const world = await createTestWorld(page, title);
  await putVersioned(
    page,
    `/api/manuscript?world=${world.id}`,
    (revision) => encodeManuscriptV1(manuscript, revision),
    { timeout: options.timeout },
  );
  if (options.open ?? true) {
    await page.goto(`/?world=${world.id}`);
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  }
  return world;
}
