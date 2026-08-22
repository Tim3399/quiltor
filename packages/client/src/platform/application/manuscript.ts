import type { Manuscript } from "../../modules/manuscript";

export interface ManuscriptGateway {
  load(): Promise<Manuscript>;
  save(data: Manuscript): Promise<{ ok: boolean; zeit: string; revision: number }>;
}
