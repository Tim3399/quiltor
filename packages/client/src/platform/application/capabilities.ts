import type { CapabilitiesV1 } from "../contracts/v1/capabilities";

export interface CapabilitiesGateway {
  /** Null when the server answers something that is not a v1 capabilities answer. */
  current(): Promise<CapabilitiesV1 | null>;
}
