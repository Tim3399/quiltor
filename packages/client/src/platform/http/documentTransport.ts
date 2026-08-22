import { ApplicationGatewayError } from "../application";
import { DOCUMENT_MEDIA_TYPE_V1, type DecodedDocumentV1 } from "../contracts/v1/documentEnvelope";
import { currentMessages } from "./locale";
import { httpResponseError, readJson, withWorldQuery, type HttpApplicationState } from "./request";

type DocumentKind = keyof HttpApplicationState["revisions"];

type DocumentTransport<TModel extends object> = {
  load(): Promise<TModel>;
  save(data: TModel): Promise<{ ok: boolean; zeit: string; revision: number }>;
};

function invalidDocumentResponse(): ApplicationGatewayError {
  return new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
}

function responseRevision(response: Response): number | undefined {
  const header = response.headers.get("ETag");
  if (header === null) return undefined;
  const match = /^"(\d+)"$/.exec(header);
  if (!match) throw invalidDocumentResponse();
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision) || revision < 0) throw invalidDocumentResponse();
  return revision;
}

export function createDocumentTransport<TModel extends object>(
  state: HttpApplicationState,
  {
    url,
    kind,
    decode,
    encode,
  }: {
    url: string;
    kind: DocumentKind;
    decode: (wire: unknown) => DecodedDocumentV1<TModel>;
    encode: (model: TModel, revision?: number) => object;
  },
): DocumentTransport<TModel> {
  return {
    load: async () => {
      const response = await fetch(withWorldQuery(state, url), {
        cache: "no-store",
        headers: { Accept: DOCUMENT_MEDIA_TYPE_V1 },
      });
      const data = await readJson(response);
      if (!response.ok) throw httpResponseError(response, data);
      let decoded: DecodedDocumentV1<TModel>;
      try {
        decoded = decode(data);
      } catch {
        throw invalidDocumentResponse();
      }
      const taggedRevision = responseRevision(response);
      if (
        taggedRevision !== undefined &&
        decoded.revision !== undefined &&
        taggedRevision !== decoded.revision
      ) {
        throw invalidDocumentResponse();
      }
      state.revisions[kind] = decoded.revision ?? taggedRevision ?? 0;
      return decoded.document;
    },
    save: async (data: TModel) => {
      const response = await fetch(withWorldQuery(state, url), {
        method: "PUT",
        headers: {
          Accept: DOCUMENT_MEDIA_TYPE_V1,
          "Content-Type": "application/json",
          "If-Match": `"${state.revisions[kind]}"`,
        },
        body: JSON.stringify(encode(data, state.revisions[kind])),
      });
      const result = await readJson(response);
      if (!response.ok) throw httpResponseError(response, result);
      if (result === null || typeof result !== "object" || Array.isArray(result)) {
        throw invalidDocumentResponse();
      }
      const record = result as Record<string, unknown>;
      if (
        record.ok !== true ||
        typeof record.zeit !== "string" ||
        typeof record.revision !== "number" ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 0
      ) {
        throw invalidDocumentResponse();
      }
      const taggedRevision = responseRevision(response);
      if (taggedRevision !== undefined && taggedRevision !== record.revision) {
        throw invalidDocumentResponse();
      }
      state.revisions[kind] = record.revision;
      return { ok: true, zeit: record.zeit, revision: record.revision };
    },
  };
}
