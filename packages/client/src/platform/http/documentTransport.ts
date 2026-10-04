import type { VersionedDocument, VersionedDocumentGateway } from "../application";
import { ApplicationGatewayError } from "../application";
import { type DecodedDocumentV1, DOCUMENT_MEDIA_TYPE_V1 } from "../contracts/v1/documentEnvelope";
import { currentMessages } from "./locale";
import {
  currentWorldSelection,
  type HttpApplicationState,
  type HttpWorldSelection,
  httpResponseError,
  isCurrentWorldSelection,
  readJson,
  withSelectedWorldQuery,
} from "./request";

type DocumentKind = keyof HttpApplicationState["revisions"];

function invalidDocumentResponse(): ApplicationGatewayError {
  return new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
}

function staleDocumentSelection(): ApplicationGatewayError {
  return new ApplicationGatewayError(
    currentMessages().errorConflict,
    "document.revision_conflict",
    {
      category: "conflict",
      retryable: true,
    },
  );
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
): VersionedDocumentGateway<TModel> {
  const peekSelections = new WeakMap<VersionedDocument<TModel>, HttpWorldSelection>();
  const read = async (): Promise<{
    versioned: VersionedDocument<TModel>;
    selection: HttpWorldSelection;
  }> => {
    const selection = currentWorldSelection(state);
    const response = await fetch(withSelectedWorldQuery(selection, url), {
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
    return {
      versioned: {
        document: decoded.document,
        revision: decoded.revision ?? taggedRevision ?? 0,
      },
      selection,
    };
  };

  const saveExpected = async (data: TModel, expectedRevision: number) => {
    const selection = currentWorldSelection(state);
    const response = await fetch(withSelectedWorldQuery(selection, url), {
      method: "PUT",
      headers: {
        Accept: DOCUMENT_MEDIA_TYPE_V1,
        "Content-Type": "application/json",
        "If-Match": `"${expectedRevision}"`,
      },
      body: JSON.stringify(encode(data, expectedRevision)),
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
    if (
      record.warnings !== undefined &&
      (!Array.isArray(record.warnings) ||
        record.warnings.some((warning) => warning !== "backup.mirror_failed"))
    ) {
      throw invalidDocumentResponse();
    }
    const taggedRevision = responseRevision(response);
    if (taggedRevision !== undefined && taggedRevision !== record.revision) {
      throw invalidDocumentResponse();
    }
    if (isCurrentWorldSelection(state, selection)) state.revisions[kind] = record.revision;
    return {
      ok: true as const,
      zeit: record.zeit,
      revision: record.revision,
      ...(record.warnings ? { warnings: record.warnings as Array<"backup.mirror_failed"> } : {}),
    };
  };

  return {
    load: async () => {
      const { versioned, selection } = await read();
      if (isCurrentWorldSelection(state, selection)) state.revisions[kind] = versioned.revision;
      return versioned.document;
    },
    peek: async () => {
      const { versioned, selection } = await read();
      peekSelections.set(versioned, selection);
      return versioned;
    },
    adoptPersisted: (versioned) => {
      const selection = peekSelections.get(versioned);
      if (selection && !isCurrentWorldSelection(state, selection)) throw staleDocumentSelection();
      state.revisions[kind] = versioned.revision;
      return versioned.document;
    },
    save: (data) => saveExpected(data, state.revisions[kind]),
    saveExpected,
  };
}
