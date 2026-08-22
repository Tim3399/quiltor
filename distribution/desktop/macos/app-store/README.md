# macOS App Store target

Status: **scaffold**. The profile and sandbox contract are valid, but there is
deliberately no build entrypoint until the bundled inference runtime, App Store
provisioning profile and `productbuild` pipeline are available and exercised on
Apple hardware.

Activation requires all of the following:

- an Apple Distribution certificate and Mac Installer Distribution certificate;
- an App Store provisioning profile matching `app.quiltor.desktop`;
- a same-Team-ID signed bundled runtime (no executable downloads);
- a sandbox integration test for import/export security-scoped URLs;
- `productbuild`, signature verification and App Store validation in CI.

The checked-in `entitlements.plist` is the reviewed sandbox boundary, not proof
that a Store binary currently exists.
