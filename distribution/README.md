# Quiltor distribution

This directory owns everything that turns reviewed source into an installable or
publishable product. Product modules do not branch on store names; every artifact
is built against one declarative profile in `profiles/`, and the matching runtime
constraints are embedded as `quiltor-build-profile.json`.

## Target matrix

| Profile           | Artifact                      | Build     | Publication destination | Release / rollout       |
| ----------------- | ----------------------------- | --------- | ----------------------- | ----------------------- |
| `macos-direct`    | Developer ID `.app` in `.dmg` | supported | GitHub Release          | stable / public         |
| `windows-direct`  | Authenticode `.exe` installer | supported | GitHub Release          | stable / public         |
| `web-self-hosted` | OCI image                     | supported | container registry      | stable / public         |
| `python-package`  | wheel and sdist               | supported | GitHub Release          | stable / public         |
| `linux-direct`    | AppImage                      | scaffold  | GitHub Release          | stable / public         |
| `macos-app-store` | sandboxed `.pkg`              | scaffold  | App Store               | TestFlight / internal   |
| `windows-store`   | `.msix` bundle                | scaffold  | Microsoft Store         | store production/public |
| `ios-app-store`   | `.ipa`                        | scaffold  | App Store               | TestFlight / internal   |
| `android-play`    | `.aab`                        | scaffold  | Google Play             | Play internal/internal  |

`publication.channel` answers where bytes are uploaded. `release.channel` and
`release.rolloutTrack` answer which audience stream receives them. These axes are
deliberately separate: publishing to Google Play, for example, does not imply the
internal, beta, staged, or production rollout track.

`scaffold` is a hard state, not a euphemism for an untested build. Such a profile
has no entrypoint or output pattern, is contract-tested, and cannot be selected by
a release workflow until its platform host and signing pipeline actually exist.

## Validate the contracts

The validator uses only Python's standard library and therefore runs before build
dependencies are installed:

```bash
python distribution/tooling/profile_contract.py validate
python distribution/tooling/profile_contract.py check-release
```

It checks the complete target set, field ownership, profile/file identity,
cross-field platform constraints, referenced paths, plist syntax, sandbox
entitlements and all version copies. `check-release` is part of the normal test and
version-bump gates.

To inspect the exact contract embedded in a target:

```bash
python distribution/tooling/profile_contract.py materialize macos-direct
```

The generated file is reproducible and ignored under
`distribution/.build/<profile>/`. PyInstaller places it at
`quiltor/infrastructure/platform/quiltor-build-profile.json`, where the runtime capability layer
loads it. A release artifact therefore cannot silently claim a different sandbox
or update provider from the profile that built it. The embedded contract also
preserves the release channel and background-execution capability used by runtime
composition; neither is inferred from the publication destination.

The OCI build materializes `web-self-hosted` inside its builder and excludes the
checked-in `source` fallback from the Docker context. Hatch does the same for
`python-package`; the release job inspects both wheel and sdist before upload and
rejects either archive if its embedded document differs from the profile contract.
Both package files use GitHub Release for publication and updates; the profile
does not claim a Python package index while no PyPI publication workflow exists.

## Direct desktop builds

Create and activate a CPython 3.11.9 virtual environment. Install the reviewed
bootstrap lock first, then the lock for the current target; the PyInstaller spec
loads Quiltor directly from `src/`, so an editable project install is neither
needed nor allowed in a release build.

```bash
python -m pip install --require-hashes \
  --requirement distribution/python-build-bootstrap.lock
# macOS arm64:
python -m pip install --require-hashes --no-build-isolation \
  --requirement distribution/desktop/macos/direct/requirements.lock
# Windows x86_64 (run instead of the macOS command):
python -m pip install --require-hashes --no-build-isolation \
  --requirement distribution/desktop/windows/direct/requirements.lock
```

Build on the target operating system:

```bash
./distribution/desktop/macos/direct/build.sh
powershell -File distribution/desktop/windows/direct/build.ps1
```

Outputs are isolated by profile:

```text
distribution/artifacts/macos-direct/Quiltor-<version>.dmg
distribution/artifacts/windows-direct/Quiltor-Setup-<version>.exe
```

Both scripts rebuild the web client, materialise the selected runtime profile and
run PyInstaller from `desktop/pyinstaller/quiltor.spec`. They deliberately pin the
profile so a stale environment variable cannot turn a direct build into a Store
artifact.

### macOS signing and notarisation

Local unsigned builds remain possible for development. A distributable build sets:

```bash
export QUILTOR_SIGN_IDENTITY="Developer ID Application: Example (TEAMID)"
export QUILTOR_NOTARY_PROFILE="quiltor-notary"
./distribution/desktop/macos/direct/build.sh
```

`QUILTOR_NOTARY_KEYCHAIN` selects a non-login keychain in CI. The script signs
nested Mach-O binaries inside-out, signs the app with the direct-build
entitlements, verifies the signature, notarises and staples the app, then repeats
verification/notarisation for the DMG. A notary profile without a signing identity
is rejected before the build.

Release CI sets `QUILTOR_REQUIRE_SIGNING=1`, requires all certificate and notary
secrets, and fails before upload if signing, notarization, stapling, or verification
does not succeed. It emits a digest-bound signature record for the publisher.

The Mac App Store entitlement file is intentionally separate under
`desktop/macos/app-store/`; it enables the App Sandbox and must never be used for a
Developer ID artifact.

### Windows signing

Unsigned local builds remain possible. Production signing is enabled with either
a PFX file or an installed-certificate thumbprint:

```powershell
$env:QUILTOR_WINDOWS_CERTIFICATE_PATH = "C:\\secure\\quiltor.pfx"
$env:QUILTOR_WINDOWS_CERTIFICATE_PASSWORD = "..."
# alternatively: $env:QUILTOR_WINDOWS_CERTIFICATE_SHA1 = "thumbprint"
powershell -File distribution/desktop/windows/direct/build.ps1
```

`QUILTOR_WINDOWS_TIMESTAMP_URL` can override the RFC 3161 timestamp service. The
script signs and verifies both the frozen `Quiltor.exe` and final Setup executable.
It never stores a certificate or password in the repository.

Release CI likewise sets `QUILTOR_REQUIRE_SIGNING=1`; missing credentials, missing
Inno Setup, or a failed Authenticode verification is a hard failure. The publisher
accepts the installer only when its signature record matches the manifest and
artifact digest.

### Native lifecycle smoke gate

The two `supported` direct-desktop profiles declare a `smokeEntrypoint`. Release
CI runs it after signature/notarization verification and before the artifact can
be uploaded or enter the release manifest. The scripts use an isolated temporary
install and data root, install and launch the signed artifact, require the
`/api/version` readiness response, exercise an in-place upgrade, and then use the
platform uninstall path. They fail unless application processes, mount points,
install files and (on Windows) the Apps & Features registration are gone.

For a real upgrade, the gate authenticates to this repository's GitHub Releases,
selects the immediate earlier stable canonical DMG/installer, downloads it through
the asset API, and verifies its platform signature and publisher identity before
execution. Only a repository with no published stable semantic release and no
semantic-version tag enters the explicitly logged `BOOTSTRAP` path. Tags count as stable
history: an equal/newer tag or a predecessor tag without one canonical published
release therefore fails closed instead of becoming Bootstrap. If a predecessor release exists but its
canonical platform artifact is missing or ambiguous, the gate fails closed. The
selected tag, artifact name, installed bundle/registry version and health response
must identify the same semantic version, which must be lower than the current
version. The Bootstrap path still performs a clean install, launch, same-version
reinstall, second launch and uninstall rather than skipping the lifecycle check.
API, authentication, signature, metadata, or download errors fail the release.

The same scripts can be run locally on their native operating system after
building a signed artifact. Set `GH_TOKEN` and `GITHUB_REPOSITORY` to test against
release history, or provide a trusted local predecessor with
`QUILTOR_PREVIOUS_DMG` / `QUILTOR_PREVIOUS_INSTALLER` plus the matching
`QUILTOR_PREVIOUS_VERSION`; it is still signature-checked and version-bound. The
Windows smoke checks the exact fixed Inno AppId registry key before any install
and refuses to run when that product is already registered for the current user,
so it cannot overwrite a developer's real install. A clean disposable account or
CI runner is therefore the supported Windows test boundary. Store/mobile and
Linux-direct profiles remain explicit scaffolds and declare no lifecycle-smoke
entrypoint.

## Release ownership

Build and publish are separate workflows:

- `release.yml` validates version/profile contracts and produces immutable,
  named artifacts only after its own complete portable release gate succeeds.
- `release-publish.yml` consumes one successful build run, verifies its manifest
  and expected files, then promotes those exact artifacts. It does not rebuild.

The manifest records the canonical concrete filename and SHA-256 digest of the
DMG, Windows installer, wheel and sdist. OCI images are recorded by immutable
`repository@sha256:...` reference rather than a version tag, together with the
path and SHA-256 digest of the artifact contract that defines each image. The build workflow
pushes only a unique run/attempt/SHA hand-off tag; the authorized publish
workflow assigns both the public version and `latest` tags together from the
verified digest. Manual publication additionally proves that the selected run came from
`.github/workflows/release.yml`, completed on `main`, succeeded and names a
revision equal to the exact current `main` head. Build and publish gates also
require `VERSION` to be newer than every published stable release and every
semantic-version tag before artifacts can be built or a release can be created.

Store/mobile profiles are validated in CI but have no build or publish job while
their status is `scaffold`. Platform-specific activation requirements live beside
each target. Store-facing localised copy lives under `store-listings/`, separate
from UI translation catalogs and from signing credentials.
Apple metadata is target-owned: macOS uses `store-listings/apple/macos/`
and iOS uses `store-listings/apple/ios/`. App records, screenshots and privacy
answers therefore cannot accidentally cross between the two application IDs.

## Version changes

```bash
python distribution/tooling/set_version.py patch
# or: major, minor, or an explicit X.Y.Z
```

Before writing, this runs the complete portable release preflight: repository
formatting, distribution and workflow dependency contracts, Python suites,
Cargo formatting/lints/tests with the committed lockfile, frontend tests/build,
committed web assets, browser tests, a real wheel and sdist build with embedded
profile verification, and real builds plus in-container checks for both OCI
images. Docker and the Python `build`/`hatchling`/`editables` packages are therefore mandatory
and the bump fails closed when they are unavailable. It then updates `VERSION`,
npm package files, the workspace `Cargo.toml` and both local-crate entries in
`Cargo.lock` together. Review and commit the resulting version-only diff;
publication is still a separate release action.

The release/CI build toolchain is exact: Node.js 22.23.2 with npm 10.9.8,
CPython 3.11.9 and Rust/Cargo 1.98.0, plus `build==1.5.0`,
`editables==0.5`, `hatchling==1.31.0` and `ruff==0.16.4`.
Native release runners install `pyinstaller==6.22.0`. The Windows job downloads
Inno Setup 6.7.1 from its versioned upstream URL and verifies the committed
SHA-256 before executing it. These build versions live in
`distribution/toolchains.json`; they are not a claim about every target runtime.
The web OCI target asserts CPython 3.12.3 in
both build and final stages, while the backup OCI target inherits CPython
3.12.13 from its digest-bound base image. Their roles and versions are recorded
separately in `distribution/dependency-locks.json` and
`distribution/containers/base-images.json`.

### Regenerating Python dependency locks

The lock generator is itself pinned to `uv==0.12.5`. Its immutable resolver
cutoff, input files, CPython version and target platform are committed in
`distribution/dependency-locks.json`. After intentionally changing an input:

```bash
python -m pip install "uv==0.12.5"
python distribution/tooling/regenerate_dependency_locks.py
python distribution/tooling/dependency_lock_contract.py check
```

Use `regenerate_dependency_locks.py --check` to compare without writing. The
script updates every lock and its SHA-256 record as one set. Windows x86_64 can
be installed and smoked locally on Windows; macOS arm64 wheel compatibility is
finally proven by the mandatory native GitHub runner using the exact same
`pip install --require-hashes --no-build-isolation` command.

The portable preflight cannot honestly produce the signed, notarized macOS DMG
or signed Windows installer on one developer host. Those platform-bound builds
remain mandatory jobs on their native release runners after the version commit;
Store and mobile profiles remain non-buildable scaffolds. This is the explicit
boundary—not an omission of portable packaging work.

GitHub jobs use explicit `ubuntu-24.04`, `macos-15` arm64 and `windows-2025`
labels. GitHub still refreshes the VM images behind those versioned labels, and
the digest-bound web image still reads Ubuntu packages from the distribution
archive during `apt-get`; native and OCI artifacts are therefore verified and
dependency-locked, but not claimed to be bit-for-bit reproducible across time.

All five target files, including `Cargo.lock`, are rendered and parsed before the
first replacement. Temporary files are staged beside their targets and a failed
replacement rolls back files already replaced, so a failed bump leaves no partial
cross-ecosystem version.
