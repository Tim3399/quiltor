# Release 3.22.0 and local review

Requested: 2026-10-04. Status: in progress. The owner requested commit, push, tag
and then a local launch for inspection. The earlier minor-version preference is
retained; the latest published release and main baseline are 3.21.0 / `36aaa46`.

The [two newly reported defects](release-blockers-2026-10-04.md) have now received
reviewed local corrections: occupied-map deletion is blocked, empty deletion
cleans references, the mobile action is reachable, and image uploads gain bounded
client validation and actionable diagnostics. The exact historic production upload
condition remains unconfirmed even after proxy inspection; it is not labelled fixed
or deployed. Build, 1,560 client tests, 1,102 Python tests (6 skips) and direct-dist
browser checks passed. Final source integration and the full release preflight are
next. VERSION remains 3.21.0. The previous preflight stopped before any version
mutation. Accepted audit/knowledgebase commit `166e06d` is already pushed. The owner
selected reuse of existing local projects.

- **Was:** integrate the accepted EPUB/mobile/audit changes and coordination
  records, prepare 3.22.0 through the declared updater, push the release revision,
  obtain the release tag through the existing publication workflow and launch it locally.
- **Warum:** make the reviewed work durable and installable and let the owner
  inspect the complete application.
- **Wann erledigt:** committed/pushed revision and matching tag verified, required
  release checks/publication completed, local API and frontend running with verified
  version/source identity and a user-facing URL.

The source acceptance baseline is `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`:
Test 37216539640 passed all 22 jobs. Existing failure observations remain in the
audit CI ledger. Release validation must run on the actual release revision.

The version updater requires a clean checkout and full local preflight, then writes
the five declared manifest files. It does not commit or tag. A VERSION change pushed
to main starts Release Build; Release Publish creates the tag after successful
artifact verification. Creating the tag before that build would make its existing-tag
gate fail, so the requested tag will be produced through this supported sequence.

The coordinator owns Git integration and final acceptance. `epub_serializer` inspects
the exact release environment before any version mutation. The author pilot remains
deferred; production deployment is outside this request.
