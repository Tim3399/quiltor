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
}

export interface DocumentSaveResult {
  ok: boolean;
  zeit: string;
  revision: number;
  warnings?: Array<"backup.mirror_failed">;
}
