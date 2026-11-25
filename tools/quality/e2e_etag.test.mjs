import assert from "node:assert/strict";
import test from "node:test";

// Lives outside tests/e2e: Playwright would load a *.test.mjs there as a test file, and the
// TAP output of node:test would corrupt its JSON listing (test-shards).
import { revisionFromEtag } from "../../tests/e2e/support/etag.ts";

test("reads the revision from plain, weak and proxy-extended ETags", () => {
  assert.equal(revisionFromEtag('"7"'), 7);
  assert.equal(revisionFromEtag('W/"7"'), 7);
  assert.equal(revisionFromEtag('"7-zstd"'), 7);
  assert.equal(revisionFromEtag('"7-gzip"'), 7);
  assert.equal(revisionFromEtag('"7-br"'), 7);
});

test("a missing ETag is revision 0", () => {
  assert.equal(revisionFromEtag(undefined), 0);
  assert.equal(revisionFromEtag(""), 0);
});

test("an ETag of another shape fails instead of becoming NaN", () => {
  assert.throws(() => revisionFromEtag('"abc"'), /unexpected ETag/);
  assert.throws(() => revisionFromEtag("7"), /unexpected ETag/);
});
