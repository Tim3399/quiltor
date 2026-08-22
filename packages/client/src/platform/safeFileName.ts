const MAX_FILE_NAME_BYTES = 255;
const INVALID_FILE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))$/iu;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(
      ({ segment }) => segment,
    );
  }
  return Array.from(value);
}

function truncateUtf8(value: string, budget: number): string {
  let result = "";
  for (const grapheme of graphemes(value)) {
    if (byteLength(result + grapheme) > budget) break;
    result += grapheme;
  }
  return result;
}

function trimUnsafeEdges(value: string): string {
  return value.replace(/^[\s.]+|[\s.]+$/g, "");
}

/** One deterministic filename policy for browser downloads and native save dialogs. */
export function safeFileName(input: string, fallback = "Export"): string {
  const normalized = String(input)
    .normalize("NFC")
    .replace(INVALID_FILE_CHARACTERS, " - ")
    .replace(/\s+-\s+(?:-\s+)+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = trimUnsafeEdges(normalized) || fallback;
  const dot = cleaned.lastIndexOf(".");
  const candidateExtension = dot > 0 ? cleaned.slice(dot) : "";
  const extension = byteLength(candidateExtension) <= 32 ? candidateExtension : "";
  let base = trimUnsafeEdges(extension ? cleaned.slice(0, -extension.length) : cleaned) || fallback;

  const firstDot = base.indexOf(".");
  const firstSegment = trimUnsafeEdges(firstDot < 0 ? base : base.slice(0, firstDot));
  if (WINDOWS_RESERVED_STEM.test(firstSegment)) {
    const suffix = firstDot < 0 ? "" : base.slice(firstDot);
    base = `${firstSegment}-Datei${suffix}`;
  }

  const baseBudget = Math.max(1, MAX_FILE_NAME_BYTES - byteLength(extension));
  base = trimUnsafeEdges(truncateUtf8(base, baseBudget)) || fallback;
  const result = `${base}${extension}`;
  return byteLength(result) <= MAX_FILE_NAME_BYTES
    ? result
    : truncateUtf8(result, MAX_FILE_NAME_BYTES);
}
