import type { WorldInfo } from "../../modules/story-world";

export interface WorldsGateway {
  select(id: string): void;
  list(): Promise<{ ok: boolean; worlds: WorldInfo[] }>;
  open(id: string): Promise<{ ok: boolean; world: WorldInfo }>;
  create(title: string, backupUrl: string): Promise<{ ok: boolean; world: WorldInfo }>;
  delete(id: string): Promise<{ ok: boolean }>;
}
