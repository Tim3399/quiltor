export interface DocumentsGateway {
  renderBookPdf(): Promise<Blob>;
  saveBookPdf(blob: Blob): Promise<void>;
  /** Compatibility wrapper for callers that still render and save in one step. */
  bookPdf(): Promise<void>;
}
