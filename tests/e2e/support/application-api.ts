import type { Route } from "@playwright/test";
import revisionConflictFixture from "../../../contracts/fixtures/application-api/structured-error/revision-conflict.v1.json" with {
  type: "json",
};
import type { Manuscript } from "../../../packages/client/src/modules/manuscript";
import type { FigureState } from "../../../packages/client/src/modules/story-world";
import { DOCUMENT_MEDIA_TYPE_V1 } from "../../../packages/client/src/platform/contracts/v1/documentEnvelope";
import {
  decodeManuscriptV1,
  encodeManuscriptV1,
} from "../../../packages/client/src/platform/contracts/v1/manuscript";
import { encodeStoryWorldV1 } from "../../../packages/client/src/platform/contracts/v1/storyWorld";

function documentHeaders(revision: number) {
  return {
    "Content-Type": DOCUMENT_MEDIA_TYPE_V1,
    ETag: `"${revision}"`,
  };
}

export function fulfillManuscript(
  route: Route,
  manuscript: Manuscript,
  revision = 0,
): Promise<void> {
  return route.fulfill({
    json: encodeManuscriptV1(manuscript, revision),
    headers: documentHeaders(revision),
  });
}

export function fulfillStoryWorld(
  route: Route,
  storyWorld: FigureState,
  revision = 0,
): Promise<void> {
  return route.fulfill({
    json: encodeStoryWorldDocument(storyWorld, revision),
    headers: documentHeaders(revision),
  });
}

export function encodeStoryWorldDocument(storyWorld: FigureState, revision: number) {
  return encodeStoryWorldV1(storyWorld, revision);
}

export function fulfillDocumentSave(route: Route, revision: number, zeit = "12:00") {
  return route.fulfill({
    json: { ok: true, zeit, revision },
    headers: { "Content-Type": "application/json", ETag: `"${revision}"` },
  });
}

export function fulfillRevisionConflict(route: Route, expected: number, actual: number) {
  return route.fulfill({
    status: 409,
    json: {
      ok: false,
      error: {
        ...revisionConflictFixture,
        params: { ...revisionConflictFixture.params, expected, actual },
      },
    },
    headers: { "Content-Type": "application/json" },
  });
}

export function decodeSavedManuscript<T>(route: Route): T {
  return decodeManuscriptV1(route.request().postDataJSON()).document as T;
}
