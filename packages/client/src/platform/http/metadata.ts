import type { MetadataGateway } from "../application";
import { requestJson } from "./request";

export function createMetadataHttpGateway(): MetadataGateway {
  return {
    version: () => requestJson<{ ok: boolean; version: string }>("/api/version"),
  };
}
