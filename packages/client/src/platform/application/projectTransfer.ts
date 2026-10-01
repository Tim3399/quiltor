import type { WorldInfo } from "../../modules/story-world";

export interface ProjectTransferCounts {
  chapters: number;
  bookChapters: number;
  setAsideChapters: number;
  trashedChapters: number;
  figures: number;
  storyboards: number;
  images: number;
}

export interface ProjectTransferPreview {
  title: string;
  counts: ProjectTransferCounts;
  includes: { trash: true; history: false };
}

export interface ProjectTransferGateway {
  exportProject(worldId: string): Promise<Blob>;
  preview(archive: Blob): Promise<{ ok: true; preview: ProjectTransferPreview }>;
  importProject(archive: Blob): Promise<{ ok: true; world: WorldInfo }>;
}
