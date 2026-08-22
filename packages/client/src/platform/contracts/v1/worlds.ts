import type { WorldInfo } from "../../../modules/story-world";

export interface WorldInfoWireV1 {
  id: string;
  title: string;
  backupUrl: string;
  updated: string;
}

export function decodeWorldInfoV1(wire: WorldInfoWireV1): WorldInfo {
  return { ...wire };
}
