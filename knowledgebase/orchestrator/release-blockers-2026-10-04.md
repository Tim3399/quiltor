# User-reported release blockers — 2026-10-04

The owner added two concrete defects before the requested 3.22.0 publication and
local launch. The lead coordinates and reviews; agents own investigation and
implementation. The completed four-point audit remains scoped historical evidence,
not a claim that no additional defects can exist.

## BUG-MAP-DELETE-01 — Accepted locally; release pending

- **Was:** prevent deleting a map that still contains placed locations. The owner
  explicitly accepts either refusing deletion or retaining locations at the old map
  position; the coordinator selected refusal as the smaller safe correction.
- **Warum:** the owner reports that deleting the map also deletes its locations.
- **Wann erledigt:** the destructive behavior is reproduced with isolated data;
  the correct shared action enforces the occupied-map guard; UI explains the block;
  empty-map deletion remains valid; meaningful regression/mutation checks and
  independent review confirm location IDs, content and placement are retained.
- **Ownership:** `epub_frontend` investigates and will implement the client/UI
  correction; `epub_serializer` independently traces domain/API callers and the
  proper invariant. Product file ownership is assigned after their source findings.
- Implementation ownership is now assigned: `PlacesWorkspace.tsx`, its existing
  test file and `locales/de/places.ts` / `locales/en/places.ts` belong exclusively
  to `epub_frontend`. It must guard both opening and confirming deletion, including
  a child added while confirmation was already open. The independent reviewer
  must not edit these paths.
- Independent domain/API reproduction confirmed that deletion removes the parent
  locally but leaves children with its old `parentPlaceId`, making them unreachable.
  The invalid draft cannot be saved: an isolated application save returned
  `document.invalid_state`, retained revision 1 and preserved both persisted nodes.
  The TypeScript wire encoder rejects the same dangling parent before sending.
  This is not a SQLite cascade; invisible local nodes and subsequently unsaved edits
  are the actual risk. No separate CLI, MCP or HTTP delete operation exists.
- The client guard is implemented and frozen for review. It checks current direct
  children both before opening confirmation and again before confirming. A warning
  explains the block; empty places retain deletion and reference cleanup.
  Direct children protect deeper descendants through their first ancestor.
- Evidence: focused tests failed twice before the fix, then passed 21/21; removing
  only the confirm-time guard made the stale-confirm regression fail. TypeScript,
  i18n, design gates and formatting passed. Full integrated build/test and independent
  diff acceptance remain pending. An extra scoped `biome check` found existing
  import/dependency diagnostics; the required formatting check passed.
- Independent review accepted the occupied-map and stale-confirm guards but found
  incomplete normal deletion cleanup: presence can refer to a place through
  `elementId`, and relationship versions can override endpoints. Both can retain
  dangling references after deleting an otherwise empty place. The original normal
  deletion fixture itself lacked its referenced figure. These concrete findings
  were returned to the frontend owner for valid fixtures and regression-backed
  cleanup before acceptance. No release approval has been given.
- Rework accepted in independent source review: remaining nodes feed the existing
  `prunePresence` helper; directly affected edges are removed and historical
  endpoint versions referring to the deleted place are filtered. The corrected
  regression uses real person/place/moment references. Reverting that cleanup
  failed the regression; final focused client run passed 47 tests across four files.
  The lead inspected the actual changes and requested safer retry text without
  telling users to reload potentially unsaved work. That copy correction passed
  16 mapping tests and i18n/format checks. Full build/unit gates are running.
- Integrated contributor gates completed on Node 22.23.2: `npm run build` exit 0;
  `npm test` exit 0, 230 files / 1,557 tests. Build regenerated the committed
  distribution (35 old/new JS asset pairs and index references), with unchanged
  CSS asset names. Main bundle `index-4jitzpDb.js` SHA-256
  `B9E78F7CA49ED37FBE2A5B4C1909B46F6FA2F7FCF966123CB39D9225009327CD`;
  Places bundle `PlacesWorkspace-BtWwIPhn.js` SHA-256
  `328A61440B5703DDF590F713659BADC33165BF4D0675AC2C211F3FA3E520FBCF`.
- Browser acceptance is assigned to `epub_serializer`, exclusively
  `tests/e2e/places-deletion.spec.ts`: disposable registered worlds, occupied-map
  warning without destructive confirmation, successful empty-place save, and
  retained parent/child state after reload. Run only against a fresh final build
  on an isolated port, never against the owner's local projects.
- Real browser checks passed the occupied-map guard in wide/light and regular/dark
  and normal deletion/save/reload in wide. A real compact interaction exposed a
  separate accessibility defect: selecting a place opens a modal inspector Sheet,
  whose backdrop blocks the only delete menu in the global toolbar. Closing the
  inspector clears selection, so the toolbar cannot then delete the selected place.
  A proposed desktop-action/compact-resize screenshot would test presentation only;
  the lead rejected it as proof of compact functionality. The frontend agent owns
  a minimal inspector action fix; true compact interaction remains unaccepted.
- The lead visually inspected wide/regular warning output and the presentation-only
  compact screenshot. Compact toast height stretched to roughly 394 px for three
  lines of text. Approved bounded follow-up ownership is `PlacesWorkspace` and
  `PlaceInspector` TSX/CSS/test files: use the existing danger action pattern inside
  the compact inspector; close the Sheet before guarded warning or confirmation;
  correct only local toast geometry. No desktop redesign. New build, unit tests,
  actual compact action/persistence tests and screenshots are required.
- Compact source correction and screenshots were reviewed: optional inspector
  danger action is wired only in compact mode; it closes the Sheet before warning
  or confirmation. Local `height: fit-content` removes grid stretch (about 103 px
  instead of 394 px for this warning). True compact action, blocked warning and
  empty deletion/save/reload passed alongside wide/regular cases, 5 passed and 1
  deliberate regular persistence skip. That first run used Vite on 5179; the lead
  requires a final direct Python/dist run before accepting release integration.
  No visual baselines depict the selected compact inspector, so none were changed.
- Final direct product run on `http://127.0.0.1:8029` (isolated Python server,
  temporary home/data, no Vite) passed 5 cases with 1 planned duplicate skip in
  19.9 seconds. Main, Places JS and Places CSS fetched over HTTP had the exact
  final build hashes. The server was stopped afterwards. Compact screenshots
  were refreshed from this actual distribution run. Final client suite passed
  230 files / 1,560 tests; `npm run build` passed again after the compact changes.
  Accepted final main asset: `index-Df3DG8rk.js`, SHA-256
  `5D52BDA3D6D1D7B703BAF143488F1FD0FF7CFA1A0DB3703FE56F3EDB1D7413F2`.
  Accepted Places asset: `PlacesWorkspace-BBPjRLxE.js`, SHA-256
  `6766989241DE25AB84975281D3041394DD1C5F5D6627994AD1AB498A313B1A9E`.
- Final mobile mutation removed only the compact inspector's `onDelete` wiring:
  both new mobile interaction tests failed as expected, then 38 focused tests
  passed after restoration. Focus assertions verify return to the invoking node
  for a blocked deletion and Cancel autofocus when confirmation replaces the Sheet.
  All owners have frozen source and distribution for the release preflight.
- Avoid changing arbitrary full-document PUT/import/restore semantics without
  evidence that they implement this explicit delete operation. No production data
  or user maps may be used for reproduction.

## BUG-IMAGE-UPLOAD-01 — Local prevention/diagnostics accepted; historic cause unconfirmed

- **Was:** investigate intermittent image-upload rejection on
  `https://quiltor.bananenban.de` and correct the confirmed cause/error feedback.
- **Warum:** the owner's desktop succeeds, while a friend and the owner's iPhone
  sometimes receive `Die Anfrage ist ungültig.` File type and size are unknown.
- **Wann erledigt:** available server evidence and a controlled reproduction
  distinguish supported-image conversion, format/size validation and request errors;
  the accepted correction has targeted behavior checks and useful user feedback;
  any remaining evidence gap is explicit rather than labelled HEIC without proof.
- **Ownership:** `epub_browser_tests` owns read-only production-log investigation
  and `image-upload-investigation.md`; initial frontend/backend source traces are
  complete. Implementation ownership will follow evidence, not a guessed cause.
- The production endpoint currently reports **3.20.0**. User-provided SSH access is
  `b825@192.168.178.101`; container `quiltor` uses Docker `json-file` logging.
  The lead verified access. Do not store credentials, payloads or personal IDs.
  No production modification, restart, test upload or deployment is authorized by
  this log-inspection step.
- Source findings: upload uses JSON/base64 and accepts actual PNG/JPEG/WebP bytes
  up to 10 MiB; client recoding depends on browser APIs. Relevant 400 codes lack
  distinct localization. Normal route-handled rejections are not logged in 3.20;
  parser exceptions emit structured `http.request_failed` events. The worker is
  investigating the real logs and proxy rather than treating this as a diagnosis.
- Actual application logs contain five upload parser `ValueError` events since
  container startup, latest **2026-10-04 20:44:19 Europe/Berlin**. These precede
  route-level format validation; retained logs currently omit body length and exact
  parser reason. The agent is checking proxy evidence for size/framing differences.
  Application upload/parser/validator code matches the production 3.20.0 tag.
- The effective Nginx Proxy Manager is on a separate host, `192.168.178.105`.
  The application host has no effective proxy configuration/access logs for Quiltor.
  The owner subsequently supplied user `b825`; read-only proxy inspection completed.
  All five application errors correlate to upstream/public 400s; two other uploads
  succeeded with 201. The effective proxy uses a 2000 MiB limit, HTTP/1.1 upstream,
  HTTP/2 off and default request buffering. No proxy rejection occurred for those
  five requests. Access logs omit request size and Content-Length/Transfer-Encoding,
  so the original parser condition remains unconfirmed even after proxy inspection.
  See [the production evidence](image-upload-investigation.md).
- Implementation is delegated in parallel: `epub_frontend` owns prepared-byte
  size/signature checks before base64 and specific localized upload errors;
  `epub_browser_tests` owns bounded parser reason diagnostics and route rejection
  observability with local HTTP regressions. Preserve HTTP codes and limits,
  avoid raw metadata/content logging, and do not implement speculative chunked
  parsing or expand canvas conversion without evidence. The upload's historic
  root cause remains unresolved; these corrections do not prove it retrospectively.
- Backend edit ownership is `src/quiltor/hosts/web/server.py`,
  `src/quiltor/delivery/http/routes/place_maps.py` and new
  `tests/python/test_place_map_http.py`. The existing request-invalid HTTP contract
  remains unchanged. Tests must prove that diagnostic reason fields reveal no
  arbitrary header value or request content.
- `src/quiltor/bootstrap/web.py` is additionally owned solely for wiring existing
  observability into place-map route services, preserving the capability boundary.
- Independent client review accepted the local bound/signature check and scoped
  error mapping. Exactly 10 MiB remains eligible; deeper image validation stays
  authoritative on the server. Removing the local rejection branch made both
  oversize/unsupported-byte regressions fail; restoring it passed.
- Backend source was accepted by both lead and independent frontend-agent review.
  Focused HTTP/guard/image/storage tests passed 36/36; all 1,102 Python tests ran
  with 1,096 passing and 6 skipped. Two mutations proved reason/error-code
  assertions fail when observability is broken. Focused final HTTP tests passed
  3/3 after a docstring-only clarification. Safe `transfer_encoding_present`
  boolean distinguishes missing-length requests with transfer encoding without
  storing raw headers. Original production root cause remains an external evidence
  follow-up, not a claim of a reproduced or deployed fix.

## Release and startup remain active

The accepted code plus coordination records were committed/pushed on
`codex/roadmap-followup` as `166e06dd5673010665c54a71b3fd9e1a8188207f`.
The exact-toolchain version preflight was stopped safely before version mutation
when the upload report arrived. All five manifests and generated assets remain
at their prior state; VERSION is **3.21.0**. Contracts, backend, CLI, formatting,
Rust, 1,539 frontend tests, build/dist comparison and wheel/sdist build passed
before interruption; isolated wheel smoke, OCI and browser gates were not completed.
The updater must be rerun on the reviewed corrections from a clean committed tree.

After the release/tag succeeds, replace the verified old local instance and reuse
the existing projects, as explicitly selected by the owner. The browser worker
has a PID/start-time-guarded stop/start procedure and will compare the old/new
world catalogue without exposing author content. Do not stop the old instance
while the release is held. S17 remains deferred.
