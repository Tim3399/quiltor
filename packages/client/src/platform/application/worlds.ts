import type { WorldInfo } from "../../modules/story-world";

export type TrashedWorldInfo = WorldInfo & { deletedAt: string };

export interface WorldsGateway {
  select(id: string): void;
  list(): Promise<{ ok: boolean; worlds: WorldInfo[] }>;
  listTrash(): Promise<{ ok: boolean; worlds: TrashedWorldInfo[] }>;
  open(id: string): Promise<{ ok: boolean; world: WorldInfo }>;
  create(title: string, backupUrl: string): Promise<{ ok: boolean; world: WorldInfo }>;
  delete(id: string): Promise<{ ok: boolean }>;
  restore(id: string): Promise<{ ok: boolean }>;
  purge(id: string): Promise<{ ok: boolean }>;
}
