import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { Manuscript } from "../../../packages/client/src/modules/manuscript";
import type { FigureNode, FigureState } from "../../../packages/client/src/modules/story-world";
import type { StoryboardState } from "../../../packages/client/src/modules/storyboard/model";
import { decodeManuscriptV1 } from "../../../packages/client/src/platform/contracts/v1/manuscript";
import { decodeStoryboardsV1 } from "../../../packages/client/src/platform/contracts/v1/storyboards";
import { decodeStoryWorldV1 } from "../../../packages/client/src/platform/contracts/v1/storyWorld";
import { WORLD } from "../../world/ids.generated";
import {
  buildExampleWorld,
  DICTIONARIES,
  exampleWorldTitle,
  HARBOUR_MAP_FILE,
  harbourMapId,
  type WorldLanguage,
  type WorldPart,
} from "../../world/index.mjs";
import { mockWorkshop } from "./application-api";
import { putVersioned } from "./seed";
import { createTestWorld, expect, type TestWorld } from "./world-fixture";

/*
 * The test world (tests/world/) for specs. New tests take their content from here instead of
 * inventing it inline; what a test needs and the world lacks is appended to the world.
 */

export interface ExampleWorldOptions {
  /** The language of the world's texts. The interface language is the spec's own business. */
  lang?: WorldLanguage;
  /** The parts to build; `base` is always among them. `edge` adds the x- check cases. */
  include?: readonly WorldPart[];
}

export interface SeededExampleWorld extends TestWorld {
  lang: WorldLanguage;
  /** Every id of the world, typed: `world.ids.figures.mara`. */
  ids: typeof WORLD;
  /** A text of the world in its language, by key: `world.text("el.mara.name")`. */
  text: (key: string) => string;
}

const DOCUMENTS = [
  { endpoint: "state", contract: "quiltor.story-world", key: "figures" },
  { endpoint: "manuscript", contract: "quiltor.manuscript", key: "manuscript" },
  { endpoint: "storyboards", contract: "quiltor.storyboards", key: "storyboards" },
] as const;

function textOf(lang: WorldLanguage) {
  return (key: string) => {
    const text = DICTIONARIES[lang][key];
    if (typeof text !== "string") throw new Error(`The ${lang} test world has no text "${key}".`);
    return text;
  };
}

/**
 * Creates a fresh world with the test world's content on the server, one per call, and
 * registers it with the world fixture so it is cleaned up after the test. The documents go to
 * the server raw, in their v1 envelope, exactly as the README capture seeds them.
 */
export async function seedExampleWorld(
  page: Page,
  { lang = "de", include = ["base"], open = true }: ExampleWorldOptions & { open?: boolean } = {},
): Promise<SeededExampleWorld> {
  const payloads = buildExampleWorld(lang, { include });
  const world = await createTestWorld(page, exampleWorldTitle(lang));

  const map = await page.request.post(`/api/place-maps?world=${world.id}`, {
    data: { data: readFileSync(HARBOUR_MAP_FILE).toString("base64") },
  });
  expect(map.ok(), await map.text()).toBe(true);
  expect((await map.json()).id, "the harbour map was stored under another id").toBe(harbourMapId());

  for (const { endpoint, contract, key } of DOCUMENTS) {
    await putVersioned(page, `/api/${endpoint}?world=${world.id}`, (revision) => ({
      contract,
      version: 1,
      revision,
      payload: payloads[key],
    }));
  }

  if (open) {
    await page.goto(`/?world=${world.id}`);
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  }
  return { ...world, lang, ids: WORLD, text: textOf(lang) };
}

/**
 * The test world with a version history (T-86): the check part is included, and the chapter
 * `x-chronicle` is saved as four versions with a note each. Version 1 creates the chapter, 2 and
 * 4 change its text, 3 changes only another chapter. The working copy ends equal to version 4.
 */
export async function seedExampleWorldWithHistory(
  page: Page,
  {
    lang = "de",
    include = ["base", "edge"],
    open = true,
  }: ExampleWorldOptions & { open?: boolean } = {},
): Promise<SeededExampleWorld> {
  const parts = include.includes("edge") ? include : [...include, "edge" as const];
  const world = await seedExampleWorld(page, { lang, include: parts, open: false });
  const { manuscript: payload, history } = buildExampleWorld(lang, { include: parts });
  if (!history) throw new Error("the check part describes no history");
  const chronicle = payload.chapters.find((chapter) => chapter.id === history.chapterId);
  const other = payload.chapters.find((chapter) => chapter.id === history.otherChapterId);
  if (!chronicle || !other) throw new Error("the check part holds the chapters of its history");
  const originalOther = other.body;

  for (const version of history.versions) {
    chronicle.body = version.text;
    other.body = version.elsewhere ? originalOther + history.appended.text : originalOther;
    await putVersioned(page, `/api/manuscript?world=${world.id}`, (revision) => ({
      contract: "quiltor.manuscript",
      version: 1,
      revision,
      payload,
    }));
    const saved = await page.request.post("/api/backup", {
      data: { worldId: world.id, message: version.note, push: false },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  }

  if (open) {
    await page.goto(`/?world=${world.id}`);
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  }
  return world;
}

/**
 * The test world as the client's models, for specs that mock the server. The raw payloads go
 * through the client's own decoders first, so a world the client could not read fails here.
 */
export function exampleWorldDocuments({
  lang = "de",
  include = ["base"],
}: ExampleWorldOptions = {}): {
  manuscript: Manuscript;
  storyWorld: FigureState;
  storyboards: StoryboardState;
} {
  const payloads = buildExampleWorld(lang, { include });
  const envelope = (contract: string, payload: unknown) => ({
    contract,
    version: 1,
    revision: 1,
    payload,
  });
  return {
    manuscript: decodeManuscriptV1(envelope("quiltor.manuscript", payloads.manuscript)).document,
    storyWorld: decodeStoryWorldV1(envelope("quiltor.story-world", payloads.figures)).document,
    storyboards: decodeStoryboardsV1(envelope("quiltor.storyboards", payloads.storyboards))
      .document,
  };
}

/**
 * The figures the figure graph draws as cards. A place with a picture of its own is a map and
 * is not drawn there, so a spec that counts the cards on the graph counts these.
 */
export function drawnFigures(storyWorld: FigureState): FigureNode[] {
  return storyWorld.nodes.filter((node) => !node.mapImageId);
}

/**
 * A whole mocked workshop with the test world: the documents of `exampleWorldDocuments` and
 * the harbour map under GET /api/place-map?id=<id>.
 */
export async function mockExampleWorld(
  page: Page,
  {
    lang = "de",
    include = ["base"],
    world = {
      id: "example-world",
      title: exampleWorldTitle(lang),
      backupUrl: "",
      updated: "2026-01-12T09:30:00Z",
    },
    version = "example-world",
    assistant,
  }: ExampleWorldOptions & {
    world?: Parameters<typeof mockWorkshop>[1]["world"];
    version?: string;
    assistant?: Parameters<typeof mockWorkshop>[1]["assistant"];
  } = {},
): Promise<{ ids: typeof WORLD; text: (key: string) => string }> {
  const mapId = harbourMapId();
  await page.route("**/api/place-map?*", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return id === mapId
      ? route.fulfill({ contentType: "image/png", body: readFileSync(HARBOUR_MAP_FILE) })
      : route.fulfill({ status: 404, json: { ok: false } });
  });
  await mockWorkshop(page, {
    world,
    version,
    documents: exampleWorldDocuments({ lang, include }),
    ...(assistant ? { assistant } : {}),
  });
  return { ids: WORLD, text: textOf(lang) };
}
