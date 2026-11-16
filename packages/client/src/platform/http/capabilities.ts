import type { CapabilitiesGateway } from "../application";
import { decodeCapabilitiesV1 } from "../contracts/v1/capabilities";
import { requestJson } from "./request";

export function createCapabilitiesHttpGateway(): CapabilitiesGateway {
  return {
    current: async () => decodeCapabilitiesV1(await requestJson<unknown>("/api/capabilities")),
  };
}
