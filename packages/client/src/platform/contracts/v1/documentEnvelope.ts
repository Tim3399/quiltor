import { wireInteger, wireRecord, WireContractError, type WireRecord } from "./validation";

export const DOCUMENT_MEDIA_TYPE_V1 = "application/vnd.quiltor.document.v1+json";

export type DocumentContractV1 = "quiltor.manuscript" | "quiltor.story-world";

export interface DocumentEnvelopeWireV1<TPayload extends WireRecord> {
  contract: DocumentContractV1;
  version: 1;
  revision?: number;
  payload: TPayload;
}

export interface DecodedDocumentV1<TModel> {
  document: TModel;
  revision?: number;
}

const ENVELOPE_KEYS = new Set(["contract", "version", "revision", "payload"]);

export function decodeDocumentEnvelopeV1<TPayload extends WireRecord>(
  value: unknown,
  contract: DocumentContractV1,
  decodePayload: (value: unknown, path: string) => TPayload,
): DocumentEnvelopeWireV1<TPayload> {
  const envelope = wireRecord(value, "$document");
  if (Object.keys(envelope).some((key) => !ENVELOPE_KEYS.has(key))) {
    throw new WireContractError("$document");
  }
  if (envelope.contract !== contract || envelope.version !== 1) {
    throw new WireContractError("$document.contract/version");
  }
  const revision =
    envelope.revision === undefined
      ? undefined
      : wireInteger(envelope.revision, "$document.revision", { min: 0 });
  const payload = decodePayload(envelope.payload, "$document.payload");
  return revision === undefined
    ? { contract, version: 1, payload }
    : { contract, version: 1, revision, payload };
}

export function encodeDocumentEnvelopeV1<TPayload extends WireRecord>(
  contract: DocumentContractV1,
  payload: TPayload,
  revision: number | undefined,
  decodePayload: (value: unknown, path: string) => TPayload,
): DocumentEnvelopeWireV1<TPayload> {
  const envelope: DocumentEnvelopeWireV1<TPayload> =
    revision === undefined
      ? { contract, version: 1, payload }
      : { contract, version: 1, revision, payload };
  return decodeDocumentEnvelopeV1(envelope, contract, decodePayload);
}
