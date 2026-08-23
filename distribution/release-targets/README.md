# Native release target activation

Direct macOS and Windows artifacts are explicit, source-controlled release
opt-ins. The release workflows inspect these exact marker paths at the selected
release revision:

- `distribution/release-targets/macos-direct.enabled`
- `distribution/release-targets/windows-direct.enabled`

Both markers are intentionally absent. Their absence skips the corresponding
hosted-runner build and excludes its artifact and signature record from the
release manifest and GitHub Release.

The markers are not credentials and must never contain credentials. Add a marker
only after the matching signing account, repository secrets and operational
ownership exist. Marker presence merely enables the existing fail-closed native
job: macOS still requires Developer ID signing and successful notarization, and
Windows still requires Authenticode signing. Missing or invalid signing inputs
remain release failures; there is no unsigned CI fallback.

Release history is target-specific. A target's first enabled release may use the
explicit Bootstrap lifecycle only when no stable release has ever contained its
canonical artifact. Afterwards, the upgrade smoke selects the newest earlier
stable release containing exactly one canonical artifact for that target.
Portable-only releases in between are skipped because they cannot be native
upgrade origins. Duplicate or ambiguous target assets remain hard failures, and
removing and later restoring the marker does not reset this history.
