# Release workflow boundary

`release.yml` creates immutable, named outputs and a canonical release
manifest. Every enabled image/package/installer job has the same-workflow
portable release gate as a hard dependency; a prior pull-request result is never
treated as release evidence. That gate runs Python and frontend tests,
contracts, architecture/distribution checks, Cargo formatting/lints/tests, the
production client build, committed-`dist` verification, wheel/sdist plus both
OCI builds and Playwright once. An initial job also rejects every ref except the
exact current `main` SHA before a job with artifacts or package-write access can
run. The workflow never creates a Git tag or GitHub Release and never moves a
public version or `latest` container tag. OCI builds are pushed only under a
unique `build-<run>-<attempt>-<sha>` hand-off tag and recorded by digest.

`release-publish.yml` accepts one successful build run, checks out its exact SHA,
and resolves the same source-controlled release targets. It always downloads the
manifest and Python package group and downloads a native group only when its
marker was present at that revision. It then verifies every selected file against
the manifest digest, checks every selected native signature/notarization record
against the exact desktop artifact digest, and promotes without rebuilding.
Release asset names come from the verified manifest, never hard-coded paths or
globs. Automatic publication runs only for a successful `main` build; manual
recovery requires the explicit build run ID and verifies the workflow
ID/name/path, successful conclusion, `main` branch and that the run revision is
still the exact current `main` head. Both workflows reject `VERSION` unless it is
newer than every published stable release and every semantic-version tag, so an
older build can never become the GitHub `latest` release.
OCI entries in the manifest are `repository@sha256:...` references returned by
the build action. Promotion reads those exact digests and assigns the version
and `latest` tags in one registry operation, so running the build twice cannot
retarget an earlier hand-off. Each image record also names and hashes its
artifact contract: the web build profile for the application image and
`services/backup-server/artifact-contract.json` for the backup service.

Every Rust gate runs Cargo with `--locked`. A missing or stale `Cargo.lock`
therefore fails both the fast CI workflow and the complete local/release
preflight instead of resolving a different dependency graph.

CI and local release preflight use the explicit `releaseToolchains`: Node.js
22.23.2 with npm 10.9.8, CPython 3.11.9 and Rust 1.98.0 from
`distribution/toolchains.json`; the matching dotfiles and
`rust-toolchain.toml` make the same choice outside CI. Python 3.11.9 is the last
3.11 patch with official `setup-python` assets for Linux, macOS and Windows.
Release packaging uses `build==1.5.0`, `editables==0.5`, `hatchling==1.31.0`,
`pyinstaller==6.22.0` and `ruff==0.16.4`; package builds disable build isolation
after installing those exact tools. This is a build-tool contract, not a
generic target-runtime claim. Native targets also use CPython 3.11.9; the web
OCI stages assert CPython 3.12.3 and the digest-bound backup base names CPython
3.12.13. Target roles, versions, resolver inputs and lock digests are separate
records in `distribution/dependency-locks.json`.

Enabled native jobs use versioned runner labels (`macos-15` arm64 and
`windows-2025`), while Linux jobs use `ubuntu-24.04`. The Windows installer
compiler is the official Inno Setup 6.7.1 executable at a versioned URL with a
committed SHA-256. Hosted runner images still receive maintenance updates behind
their versioned labels, so the contract promises reviewed inputs and repeatable
gates, not a bit-identical virtual machine image.

PDF runtime pins are artifact-specific rather than a false shared version: the
installable Python package extra uses the PyPI-published Playwright 1.61.0,
while the self-hosted web OCI artifact uses npm and the browser image at
Playwright 1.61.1. `artifactRuntimes` in `distribution/toolchains.json`, archive
metadata validation, the container contract and a real isolated wheel-extra
installation keep both paths fail-closed.

Signed native jobs install the exact target closure with pip hash-checking mode;
they do not resolve `.[desktop]` or install the source tree. The PyInstaller spec
analyzes the checked-out `src/` tree directly. `uv==0.12.5` and the resolver
cutoff/platform inputs are committed so
`distribution/tooling/regenerate_dependency_locks.py --check` can reproduce
the reviewed locks.

Every third-party Action is a full commit SHA listed in
`.github/actions.lock.json`, alongside the upstream ref from which that commit
was verified. `workflow_contract.py` rejects mutable tags, unknown actions,
unlocked job runtimes and publication permissions outside the two release
workflows.

The self-hosted image reads `playwright.reference` from the committed
`distribution/containers/base-images.json` lock. It must match
`mcr.microsoft.com/playwright:v1.61.1-noble@sha256:<64 lowercase hex>`; a
floating or differently versioned base image stops the build before Docker
runs. The backup Python base is checked against the same lock before its build.
The web build overlays the exact Node.js 22.23.2 binary and asserts the
effective version against `releaseToolchains`; both web stages also assert their
target CPython 3.12.3 runtime before producing an image.

`distribution-contracts.yml` validates every supported and scaffold profile on
pull requests. Scaffold targets do not get empty build jobs: their adjacent README
states the concrete activation gates.

Store credentials and signing material are repository/environment secrets. Build
profiles, listings and target markers contain no credentials. A workflow must not
silently change a profile from `scaffold` to `supported`; that state change
requires a real entrypoint, artifact check and installation test in the same
review.

Direct native release jobs are source-controlled opt-ins. The exact markers are
`distribution/release-targets/macos-direct.enabled` and
`distribution/release-targets/windows-direct.enabled`; both are intentionally
absent until their signing accounts and secrets exist. An absent marker skips the
corresponding job before a native runner is allocated. Once enabled, Release CI
has no unsigned fallback: macOS requires Developer ID signing and Apple
notarization, while Windows requires Authenticode. Their local scripts still
permit explicitly local unsigned development builds.

Bootstrap history is evaluated per native target. Its first enabled release may
bootstrap only if no stable release has ever contained that target's canonical
artifact. Afterwards, the upgrade smoke uses the newest earlier stable release
that contains exactly one canonical artifact for that target. Portable-only
releases in between are skipped because they are not native upgrade origins;
duplicate or ambiguous target assets remain release errors.
