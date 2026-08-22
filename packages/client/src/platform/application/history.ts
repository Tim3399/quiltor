export interface HistoryGateway {
  log(): Promise<{
    ok: boolean;
    commits: Array<{ hash: string; shortHash: string; date: string; subject: string }>;
  }>;
  diff(
    ref?: string,
    word?: boolean,
    all?: boolean,
  ): Promise<{ ok: boolean; diff: string; newFiles: string[]; mode: "word" | "line" }>;
  textVersion(
    ref: string,
    chapter: number,
    title: string,
  ): Promise<{ ok: boolean; isNew: boolean; text: string }>;
}
