# Portable project transfer: implementation contract

This design resolves S4.1/S4.2 before implementation. It transfers a complete current
project independently from the optional cloud. It does not replace historical backups.

## Archive

A `.quiltor` ZIP archive contains one UTF-8 `manifest.json` and raw referenced image blobs.
No SQLite file, account token, owner id, configured remote endpoint or filesystem path is
transferred. Internal content ids remain stable; importing always allocates a new world id
and assigns the current session's owner.

The version-1 manifest contains:

- `format: "quiltor-project"`, `version: 1`, title and export timestamp;
- explicit `includes: { trash: true, history: false }`;
- the existing version-1 manuscript, figures and storyboards document envelopes, without
  saved revision numbers;
- image descriptors with SHA-256 id, archive member name, MIME type, dimensions and byte size.

Current document data includes chapter inclusion state, manuscript trash, folders, notes,
formatting, time anchors, world relationships and timeline, storyboards and stable references.
Current book layout and supported extension fields must also survive. Transfer excludes
saved version history, automatic SQLite safety copies, assistant runtime/account settings,
derived mirrors and unused image blobs. The UI states the exclusions before download/import.

## Import boundary

1. Read members without extracting paths. Reject duplicate members, unsafe/unexpected member
   names, unsupported format/version, non-finite/duplicate-key JSON, and encrypted archives.
2. Bound compressed request size, total expanded size, member count and every image using
   existing supported image limits. Fail with a useful error, never silent truncation.
3. Validate all three existing document contracts, tree integrity, cross-document time
   anchors and every referenced asset before creating a visible project. Preserve valid
   dangling note/storyboard references as unresolved references, not data-loss repairs.
4. Verify asset checksums and metadata against actual image bytes. Reject missing assets.
5. Preview title, chapter/content counts and transfer inclusions/exclusions without mutation.
6. On explicit import, validate again, build an isolated new database, assign new ownership,
   and publish only after the entire project is usable. Failure leaves all existing worlds
   and the project catalogue unchanged. Importing twice produces two independent copies.

Do not reuse a supplied database path, world id, owner or remote endpoint. Do not let a
preview update active-world selection or document write revisions.

## User flow

- Within a project: `Projekt exportieren` flushes pending edits first, then downloads the
  complete current project. If flushing fails, keep the editor and emergency rescue available.
- From project selection: `Projekt importieren` selects an archive, previews it and explicitly
  creates a new copy. It never asks a new author to create a cloud account.
- `Buch exportieren` remains a distinct manuscript-only output honoring book inclusion.
- File-dialog cancellation is neutral, and failed import/export retains current work.

## Verification

Round-trip a realistic fixture into a fresh data root and compare every document, formatting,
tree ordering, inclusion/trash metadata, note/board references, anchors and binary images.
Assert the documented exclusions and new ownership/world identity. Test unsupported version,
corrupt ZIP/JSON, duplicate/traversal members, missing or tampered assets, size limits, failed
publication and two imports of the same archive. Run an HTTP and browser transfer path after
unit checks so the exercised feature is usable, not just a serializer.
