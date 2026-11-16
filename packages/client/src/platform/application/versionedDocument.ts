import type { WorldInfo } from "../../modules/story-world";

export interface VersionedDocument<T> {
  document: T;
  revision: number;
}

export interface VersionedDocumentGateway<T> {
  load(): Promise<T>;
  peek(): Promise<VersionedDocument<T>>;
  adoptPersisted(versioned: VersionedDocument<T>): T;
  save(data: T): Promise<DocumentSaveResult>;
  saveExpected(data: T, expectedRevision: number): Promise<DocumentSaveResult>;
  /**
   * The revision the next plain save() expects: the one last loaded or saved. A draft kept
   * when a save fails remembers it, so adopting the draft later cannot overwrite a version
   * that arrived in between (T-58 P7b). Undefined where the transport does not know one.
   */
  revision(): number | undefined;
}

interface DocumentSaveResult {
  ok: boolean;
  zeit: string;
  revision: number;
  warnings?: Array<"backup.mirror_failed">;
  /** Present once: the save that made a preview of the example world a real world. */
  world?: WorldInfo;
}
