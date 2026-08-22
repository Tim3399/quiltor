# Microsoft Store target

Status: **scaffold**. This directory owns the future MSIX packaging layer. It
must not contain a hand-written identity copied from Partner Center: publisher,
package identity and Store association are deployment inputs.

Activation requires an MSIX manifest generated from the Partner Center identity,
an x64/arm64 bundle, Windows App Certification Kit verification, signing, update
tests and an install/upgrade/uninstall test on a clean Windows runner.
