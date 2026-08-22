import type { FigureState } from "../../modules/story-world";

export interface StoryWorldGateway {
  load(): Promise<FigureState>;
  save(data: FigureState): Promise<{ ok: boolean; zeit: string; revision: number }>;
}
