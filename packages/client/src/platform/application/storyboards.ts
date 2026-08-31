import type { StoryboardState } from "../../modules/storyboard";

export interface StoryboardsGateway {
  load(): Promise<StoryboardState>;
  save(data: StoryboardState): Promise<{ ok: boolean; zeit: string; revision: number }>;
}
