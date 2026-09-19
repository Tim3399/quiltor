import type { Manuscript } from "../../modules/manuscript";
import type { FigureState } from "../../modules/story-world";
import type { StoryboardState } from "../../modules/storyboard";
import type {
  DocumentsGateway,
  ManuscriptGateway,
  StoryboardsGateway,
  StoryWorldGateway,
} from "../application";
import { decodeManuscriptV1, encodeManuscriptV1 } from "../contracts/v1/manuscript";
import { decodeStoryboardsV1, encodeStoryboardsV1 } from "../contracts/v1/storyboards";
import { decodeStoryWorldV1, encodeStoryWorldV1 } from "../contracts/v1/storyWorld";
import type { PlatformGateway } from "../PlatformGateway";
import { saveBlob } from "../fileSave";
import { createDocumentTransport } from "./documentTransport";
import { currentMessages } from "./locale";
import { httpResponseError, readJson, withWorldBody, type HttpApplicationState } from "./request";

export function createManuscriptHttpGateway(state: HttpApplicationState): ManuscriptGateway {
  return createDocumentTransport<Manuscript>(state, {
    url: "/api/manuscript",
    kind: "manuscript",
    decode: decodeManuscriptV1,
    encode: encodeManuscriptV1,
  });
}

export function createStoryWorldHttpGateway(state: HttpApplicationState): StoryWorldGateway {
  return createDocumentTransport<FigureState>(state, {
    url: "/api/state",
    kind: "figures",
    decode: decodeStoryWorldV1,
    encode: encodeStoryWorldV1,
  });
}

export function createStoryboardsHttpGateway(state: HttpApplicationState): StoryboardsGateway {
  return createDocumentTransport<StoryboardState>(state, {
    url: "/api/storyboards",
    kind: "storyboards",
    decode: decodeStoryboardsV1,
    encode: encodeStoryboardsV1,
  });
}

export function createDocumentsHttpGateway(
  state: HttpApplicationState,
  platform: PlatformGateway,
): DocumentsGateway {
  const renderBookPdf = async (): Promise<Blob> => {
    const response = await fetch("/api/book.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withWorldBody(state, {})),
    });
    if (!response.ok) throw httpResponseError(response, await readJson(response));
    return response.blob();
  };

  const saveBookPdf = (blob: Blob): Promise<void> =>
    saveBlob(
      platform,
      `Quiltor-Buchfassung-${new Date().toISOString().slice(0, 10)}.pdf`,
      blob,
      currentMessages().exportFailed,
    );

  return {
    renderBookPdf,
    saveBookPdf,
    bookPdf: async () => saveBookPdf(await renderBookPdf()),
  };
}
