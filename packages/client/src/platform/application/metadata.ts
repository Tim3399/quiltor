export interface MetadataGateway {
  version(): Promise<{ ok: boolean; version: string }>;
}
