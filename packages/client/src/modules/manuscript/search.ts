import type { Chapter } from "./model";

export type ManuscriptSearchMatch = {
  chapterId: string;
  from: number;
  to: number;
};

function escapedExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Literal, case-insensitive ranges in document coordinates. */
export function textSearchRanges(value: string, query: string) {
  const needle = query.trim();
  if (!needle) return [];
  const expression = new RegExp(escapedExpression(needle), "giu");
  return [...value.matchAll(expression)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }));
}

export function manuscriptSearchMatches(chapters: Chapter[], query: string) {
  return chapters.flatMap<ManuscriptSearchMatch>((chapter) =>
    textSearchRanges(chapter.body, query).map((range) => ({
      chapterId: chapter.id,
      ...range,
    })),
  );
}
