# Production image-upload investigation

Status: read-only investigation on 2026-10-04. No upload was sent, no user
content was read, and no production service or configuration was changed.

## Scope and deployed identity

The inspected application is the production instance behind
`https://quiltor.bananenban.de`. Its public version endpoint reported `3.20.0`.
The `quiltor` container on the application host was started at
`2026-10-02T14:06:07.565238028Z`, uses Docker's `json-file` log driver, and was
running image `sha256:a2c067256154f211ed3d0f516a78d110343e36b2135bbd7a499fdbd1f9db2f60`.

The deployed infrastructure inventory publishes the application on host port
8010 and describes that port as the target of Nginx Proxy Manager (NPM). The
same inventory places the effective NPM routes on a different host,
`192.168.178.105`. The authorized application host, `192.168.178.101`, listens
on 8010 but not 80 or 443. It contains no accessible NPM access log or effective
NPM configuration for Quiltor. Nginx processes found there were mapped through
their cgroups to unrelated services and were not treated as Quiltor proxy
evidence. After separate access was authorized, the effective NPM configuration
and only redacted, route-specific log fields were inspected on `.105` as well.
That proxy container was running OpenResty `1.27.1.2` from image
`sha256:08e0997ce1cc8738637b0e271a727815ea89ed564ce392e0f9035f1a03c089c5`
and had started at `2026-10-03T10:01:44.06249675Z`, before all correlated
requests.

## Production log findings

The complete application-container log from the current container start through
the inspection contained five `http.request_failed` events. All five concern
`POST /api/place-maps`, name `ValueError` as the exception type, and contain no
client IP, world ID, request body, or image data.

| Time in Europe/Berlin    | Route                  | Logged event                        | Application response implied by deployed code |
| ------------------------ | ---------------------- | ----------------------------------- | --------------------------------------------- |
| 2026-10-03 13:47:09 CEST | `POST /api/place-maps` | `http.request_failed`, `ValueError` | HTTP 400, `request.invalid`                   |
| 2026-10-03 18:46:28 CEST | `POST /api/place-maps` | `http.request_failed`, `ValueError` | HTTP 400, `request.invalid`                   |
| 2026-10-03 18:46:34 CEST | `POST /api/place-maps` | `http.request_failed`, `ValueError` | HTTP 400, `request.invalid`                   |
| 2026-10-03 18:46:58 CEST | `POST /api/place-maps` | `http.request_failed`, `ValueError` | HTTP 400, `request.invalid`                   |
| 2026-10-04 20:44:19 CEST | `POST /api/place-maps` | `http.request_failed`, `ValueError` | HTTP 400, `request.invalid`                   |

The count was checked independently: five `http.request_failed` events in all,
five on `/api/place-maps`, and zero log entries containing any of the handled
codes `place_map.invalid_request`, `place_map.invalid_encoding`, or
`place_map.image_rejected`.

### Correlated NPM evidence

NPM access rows match every application event to the second. In each case NPM
received an upstream HTTP 400 and returned HTTP 400 with a 71-byte response. Two
other uploads in the same log completed successfully through the identical
route with upstream and public HTTP 201.

| Time in Europe/Berlin    | Upstream/public status | Response bytes | Result               |
| ------------------------ | ---------------------- | -------------- | -------------------- |
| 2026-10-03 13:47:09 CEST | 400 / 400              | 71             | Matches parser event |
| 2026-10-03 18:46:28 CEST | 400 / 400              | 71             | Matches parser event |
| 2026-10-03 18:46:34 CEST | 400 / 400              | 71             | Matches parser event |
| 2026-10-03 18:46:58 CEST | 400 / 400              | 71             | Matches parser event |
| 2026-10-04 20:41:30 CEST | 201 / 201              | 144            | Successful upload    |
| 2026-10-04 20:44:19 CEST | 400 / 400              | 71             | Matches parser event |
| 2026-10-04 20:48:28 CEST | 201 / 201              | 146            | Successful upload    |

There is no matching NPM 413, gateway failure, or upstream connection error.
NPM can therefore be excluded as the component that rejected these five
correlated requests: it forwarded them, and Quiltor produced the 400 responses.

These are request-parser failures before image decoding and validation. They do
not establish an unsupported image format. A source comparison against the
`v3.20.0` tag found no changes in the relevant upload route, image validator,
application service, persistence adapter, or place-map HTTP adapter. The shared
`request.ts` has changed since that release for unrelated import and world
selection behavior, but its HTTP 400 mapping used by this upload is unchanged.

## What the application can reject

The shared JSON parser requires a positive numeric `Content-Length` no larger
than 16 MiB, reads exactly that many bytes, requires
`Content-Type: application/json` (parameters are allowed), decodes UTF-8, and
parses JSON. Any failure in those steps is logged only as the observed
`ValueError` or JSON/Unicode exception type and becomes HTTP 400
`request.invalid`.

The in-tree browser client consistently sends JSON containing a base64 `data`
field and sets the JSON content type. Consequently, the production events are
compatible with, but do not prove, either of these remaining classes:

- a request exceeding the 16 MiB JSON-body ceiling; or
- request framing that reaches the application without a usable
  `Content-Length`, including a possible `Transfer-Encoding: chunked` upstream
  request.

The effective virtual host has client-side HTTP/2 disabled, uses
`proxy_http_version 1.1` upstream, and does not override
`proxy_request_buffering`, whose Nginx default is enabled. Its error log confirms
that all seven upload request bodies above were buffered to temporary files.
This evidence weakens a theory that an HTTP/2 or directly streamed client body
passed unchanged to Quiltor. It does not reveal the generated upstream
`Content-Length` or `Transfer-Encoding`, so it cannot eliminate a framing
failure.

After JSON parsing, the route separately rejects a non-object or missing data
field, invalid base64, and image bytes that fail validation. Validation accepts
PNG, JPEG, and WebP, caps decoded bytes at 10 MiB, and caps each dimension at
20,000 pixels. Those handled HTTP 400 responses do not emit an application log,
so the absence of their error codes from the container log cannot show that no
such failures occurred. No conclusion about HEIC or any other particular user
file is supported without its local metadata.

The client maps every application HTTP 400 in this flow to the same German
message, `Die Anfrage ist ungültig.` It therefore hides the distinction between
parser failure, invalid base64, and rejected image bytes. A rejection generated
by NPM itself, such as HTTP 413, would not create an application log entry and
would normally take the client's generic unknown-error path. No such proxy
rejection occurred in the seven correlated rows.

## Logging boundary

The HTTP server intentionally suppresses the standard access log. Exceptional
dispatches emit method, normalized route, and exception class only. Handled
route errors emit no durable event. In-memory HTTP metrics retain only aggregate
method/route/outcome/error-type labels and provide neither timestamps nor a
reason. The existing production log therefore cannot distinguish invalid body
size, missing or malformed length, content type, UTF-8, or JSON for the five
events.

The effective NPM route forwards HTTP to `192.168.178.101:8010`, uses
`proxy_http_version 1.1`, and has no custom server-proxy directives. Its global
`client_max_body_size` is 2000 MiB, far above Quiltor's 16 MiB parser ceiling;
no route-specific body limit or buffering override exists. The 2000 MiB setting
and matching upstream 400 statuses rule out the proxy body-size limit as the
rejector for these cases.

The configured NPM access format records response bytes (`body_bytes_sent`), not
request bytes, received `Content-Length`, `Transfer-Encoding`, or request time.
The historical proxy logs therefore establish routing, buffering and status,
but still cannot distinguish Quiltor's invalid-size, missing-length,
content-type, UTF-8, or JSON parser branches.

## Existing tests and narrow reproduction

- `tests/python/test_server_guard.py` verifies refusal of form content types and
  acceptance of JSON with a charset parameter.
- `tests/python/test_place_map_image.py` verifies supported PNG/JPEG/WebP
  identification and refusal of empty, oversized, malformed, unsupported, and
  implausibly dimensioned images.
- `tests/python/test_place_map_storage.py` verifies persistence behavior.
- Before the diagnostic change below, no route-level HTTP test distinguished
  the place-map parser failure classes or asserted their observability.

A safe local reproduction should exercise the route with a fixture world and
four requests: valid JSON with a regular content length, a body over the parser
ceiling, a chunked request without `Content-Length`, and malformed JSON. It
should assert response status/code and the structured event fields without
uploading any personal file. This would verify behavior, but it cannot identify
which production request class occurred.

## Bounded fix proposal

The 16 MiB JSON ceiling already admits every nominally valid 10 MiB decoded
image: base64 expands 10 MiB to about 13.34 MiB, leaving about 2.66 MiB for the
JSON envelope. Raising the parser ceiling would therefore hide rather than fix
the distinction between an accepted image and an oversized one.

The client preparation path is browser-dependent today. It resizes only when an
image edge exceeds 4096 pixels and both `createImageBitmap` and
`OffscreenCanvas` are available. If either API is absent, decoding fails, the
canvas cannot be created, or conversion fails, it silently uploads the original
blob. It also leaves a byte-heavy image unchanged when its dimensions are at or
below 4096. This is a concrete cross-browser behavior difference, but the
production logs do not prove that it caused the reported failures.

A narrow implementation should:

1. Give the body parser typed, privacy-safe failures for missing or malformed
   length, body over the 16 MiB ceiling, unsupported content type, invalid
   UTF-8, and invalid JSON. Map size to a stable limit error and framing to a
   stable request-framing error. Log only the reason bucket, declared-length
   bucket, and presence of transfer encoding; never log headers verbatim,
   content, client address, or world ID.
2. Keep the current bounded `Content-Length` protocol until proxy evidence shows
   that chunked upstream requests are required. Do not add a broad chunked-body
   implementation based on the present evidence.
3. Add stable, localized client messages for `place_map.image_rejected`, the new
   body-size code, and the new framing code. The size message should state the
   supported limit and suggest choosing or reducing another image. The format
   message should list PNG, JPEG, and WebP. The framing message can safely ask
   the user to retry and report the time if it persists.
4. Make preparation deterministic enough to stay inside the server contract:
   trigger normalization for either excessive dimensions or excessive bytes;
   supply a regular canvas fallback when the worker-style APIs are unavailable;
   verify the produced blob's type and size; and stop locally with the specific
   format/size message when normalization cannot produce an acceptable result.
   Server validation remains authoritative.
5. Add focused tests for parser reason-to-code/log mapping, the endpoint-specific
   size envelope, client fallback behavior with the modern APIs absent, a
   byte-heavy image below the dimension threshold, and localized structured
   errors. A raw-socket framing test can prove the current explicit rejection
   without changing transport semantics.

This plan improves the next incident's evidence and gives the user actionable
feedback even if NPM logs remain unavailable. It does not assign a root cause to
the five existing events.

## Implemented local diagnostics and regression evidence

The backend diagnostic portion was implemented locally after collecting the
production evidence. It is not present in the inspected production `3.20.0`
container and therefore cannot recover the missing reasons for the five
historical events.

- The JSON parser now raises one typed `RequestBodyRejected` while preserving
  the existing HTTP 400 `request.invalid` response contract. Its controlled
  reasons are `missing_length`, `invalid_length`,
  `too_large`, `content_type`, `utf8`, and `json`.
- `http.request_failed` adds only that controlled reason and a boolean
  `transfer_encoding_present`. It does not log a header value, declared length,
  client address, world ID, or body.
- Handled upload refusals now emit `place_map.upload_rejected` with only the
  stable `place_map.*` error code. Response statuses and codes are unchanged.
- `tests/python/test_place_map_http.py` exercises all six parser buckets through
  a real local HTTP server. The missing-length case explicitly supplies
  `Transfer-Encoding: chunked` without `Content-Length` and confirms the
  boolean framing signal. It also proves successful PNG, JPEG, and WebP uploads
  round-trip byte-for-byte, and proves invalid request shape, invalid base64,
  and rejected image bytes neither enter storage nor leak test content or world
  identity into the event.

Executed checks:

```text
py -3.12 -m unittest tests.python.test_place_map_http tests.python.test_server_guard tests.python.test_place_map_image tests.python.test_place_map_storage
36 tests passed in 12.223s.

C:\Users\timra\AppData\Local\Programs\Python\Python312\Scripts\ruff.exe format --check src/quiltor/hosts/web/server.py src/quiltor/bootstrap/web.py src/quiltor/delivery/http/routes/place_maps.py tests/python/test_place_map_http.py
4 files already formatted.

C:\Users\timra\AppData\Local\Programs\Python\Python312\Scripts\ruff.exe check --ignore BLE001 src/quiltor/hosts/web/server.py src/quiltor/bootstrap/web.py src/quiltor/delivery/http/routes/place_maps.py tests/python/test_place_map_http.py
All checks passed. BLE001 is excluded here because server.py contains two existing broad boundary catches outside this change.

py -3.12 -m unittest discover -s tests/python -t tests/python
1,102 tests ran in 213.363s: 1,096 passed and 6 skipped.
```

Two repository mutation checks were also run and restored their source files:

- replacing `fields["reason"] = exc.reason` with a constant `unknown` made all
  six parser subcases fail on the logged reason;
- replacing the handled `error_code` with `place_map.unknown` made all three
  handled-rejection subcases fail on response and/or event code.

```text
node tools/dev/mutate.mjs src/quiltor/hosts/web/server.py --from 'fields["reason"] = exc.reason' --to 'fields["reason"] = "unknown"' -- py -3.12 -m unittest tests.python.test_place_map_http.PlaceMapHttpTests.test_parser_rejections_have_safe_specific_reason_buckets
Expected failure: 6 failing subcases; source restored.

node tools/dev/mutate.mjs src/quiltor/delivery/http/routes/place_maps.py --from 'error_code=error_code' --to 'error_code="place_map.unknown"' -- py -3.12 -m unittest tests.python.test_place_map_http.PlaceMapHttpTests.test_handled_upload_rejections_are_logged_without_user_data
Expected failure: 3 failing subcases; source restored.
```

The successful local diagnostics prevent another identical event from being
reasonless after deployment. They do not show whether any historical request
was too large, lacked a usable length, or failed another parser step. The NPM
logs exclude a proxy-generated rejection but contain no historical request size
or upstream framing field.

## Remaining evidence to resolve the parser reason

1. Match the user's approximate failure times to the five timestamps above.
   File name, project name, image bytes, and world ID are unnecessary; local
   MIME, byte size, pixel dimensions, browser, and device are sufficient.
2. The locally completed diagnostics above can classify future failures after
   deployment: controlled parser reasons, transfer-encoding presence and handled
   place-map error codes. They intentionally omit declared-length values and all
   personal data. Deployment and a new production observation have not occurred.

The strongest supported conclusion is now that five real production uploads
passed through a buffering NPM route and were rejected by Quiltor's request
parser. NPM's size limit did not reject them. Historical logs cannot identify
the exact parser condition and remain blind to handled image-format rejections;
size must not be claimed as the root cause merely because framing became less
likely.
