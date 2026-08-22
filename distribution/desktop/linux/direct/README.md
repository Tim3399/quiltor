# Linux direct distribution

`linux-direct` reserves the contract and directory boundary for a future local
Linux desktop download. It is intentionally a `scaffold`: no build entrypoint,
artifact output, CI job, verified signing implementation, or supported installer
exists yet.

The profile currently records AppImage as the intended portable artifact so the
target is explicit rather than hidden inside Windows/macOS scripts. Activating it
requires all of the following in one change:

- a tested Linux desktop host and AppImage build entrypoint;
- reproducible x86_64 and arm64 artifacts;
- signing/provenance verification and a release-manifest entry;
- install, launch, update and uninstall tests on supported distributions;
- changing both `build.status` and `publication.status` to `supported`.

Until then, release workflows must not build or publish `linux-direct`.
