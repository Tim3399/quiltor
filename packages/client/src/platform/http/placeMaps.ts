import type { PlaceMapsGateway, StoredMapImage } from "../application";
import { type HttpApplicationState, requestJson, withWorldQuery } from "./request";

/**
 * Uploads travel base64-encoded inside a JSON body rather than as multipart.
 *
 * The server accepts no other content type, and that is deliberate: a browser
 * form can only send text/plain, urlencoded or multipart, so refusing those is
 * what makes a cross-site post impossible. The encoding costs a third, once per
 * image, instead of on every save.
 */
export function createPlaceMapsHttpGateway(state: HttpApplicationState): PlaceMapsGateway {
  return {
    store: async (content: Blob) =>
      requestJson<StoredMapImage>(withWorldQuery(state, "/api/place-maps"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: await base64(content) }),
      }),
    sourceUrl: (imageId: string) =>
      withWorldQuery(state, `/api/place-map?id=${encodeURIComponent(imageId)}`),
  };
}

async function base64(content: Blob): Promise<string> {
  const bytes = new Uint8Array(await content.arrayBuffer());
  // Chunked because spreading a multi-megabyte array into `apply` overflows the
  // call stack, which is a crash rather than a failed upload.
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
