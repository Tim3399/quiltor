/**
 * The document revision carried by an ETag, as the product client reads it.
 *
 * Behind a compressing proxy the tag arrives weakened or extended: `W/"7"` (nginx),
 * `"7-zstd"` or `"7-gzip"` (Caddy). Specs that strip the quotes and call `Number` get NaN from
 * those, so every spec reads the revision through this one helper (T-381). A missing header is
 * revision 0, a fresh world. Anything else is a test failure, not a guess.
 */
export function revisionFromEtag(etag: string | undefined): number {
  if (etag === undefined || etag === "") return 0;
  const match = /^(?:W\/)?"(\d+)(?:-(?:gzip|zstd|br))?"$/.exec(etag);
  if (!match) throw new Error(`unexpected ETag: ${etag}`);
  return Number(match[1]);
}

/** The If-Match value for a revision: always the strong form the server issues itself. */
export function ifMatch(revision: number): string {
  return `"${revision}"`;
}
