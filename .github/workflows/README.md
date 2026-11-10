# Release workflow boundary

`release.yml` is the single entry point for every push to `main`. It always
calls `test.yml` at the same commit with `full_matrix: true`; its release jobs
run only when `release-plan` finds a changed `VERSION` (or on a manual
dispatch). It creates immutable, named outputs and a canonical release
manifest. Every enabled image/package/installer job has the same-workflow
release gate and the called full test matrix as hard dependencies: the matrix's
`browser-e2e` job reports `full-success` only if every required job, including
every matrix expansion, succeeded. A skipped required job is a failure. A prior
pull-request result, or a separate `test.yml` run, is never treated as release
evidence. The release gate runs as `release_preflight.py --ci-release-scope`,
which skips exactly the steps the called matrix runs at the same commit and
prints each skipped step; it runs the contracts, architecture/distribution
checks, wheel/sdist plus both OCI builds locally and the rest of the portable
gate once. An initial job also rejects every ref except the exact current
`main` SHA before a job with artifacts or package-write access can run; the only
exception is an explicit `dry_run` dispatch, which pushes no image, signs
nothing and produces no manifest, so nothing can be published from it. The
workflow never creates a Git tag or GitHub Release and never moves a public
version or `latest` container tag. OCI builds are pushed only under a unique
`build-<run>-<attempt>-<sha>` hand-off tag and recorded by digest.

## One entry point for tests

- **`test.yml` runs on pull requests and manual dispatches only.** It has no
  `push` trigger and never runs on `main` by itself. A push to `main` reaches the
  tests through the `tests` job of `release.yml`, so every main commit gets the
  full matrix whether or not it releases, and the tests run once, not twice.
- **Concurrency.** Only pull requests share a group per ref and cancel their
  superseded runs. Every other run, a dispatch or the call from `release.yml`,
  gets a group of its own, so a newer push can never cancel the tests of an older
  one. `release.yml` has no concurrency group for the same reason.
- **The verdict.** `test.yml` exposes `verdict` as a `workflow_call` output. The
  `browser-e2e` job writes it only after every check passed: `full-success` in
  full mode, `reduced-success` otherwise, and nothing when the gate is red. A
  called workflow concludes `success` even when all of its jobs were skipped, so
  the release reads the verdict, never the conclusion of the call.
- **Check names.** For pull requests the required check is `browser-e2e`. For a
  push to `main` the same job is reported as `Full test matrix / browser-e2e`
  (calling job / called job). Branch protection on `main` has to use that name;
  protection for pull requests keeps the short one.
- **Dry run.** A manual dispatch of `release.yml` with `dry_run: true` rehearses
  the whole run on any branch: every gate and build runs, but no registry login or
  push, no signing job (they read the signing secrets) and no manifest. The run
  ends red unless the verdict is `full-success`, the three unsigned artifact jobs
  succeeded and the manifest and signing jobs were skipped.
- **Contracts.** `workflow_contract.py` holds all of this: the single entry, the
  literal `full_matrix: true`, the verdict, the edges from every writing job to
  `tests` and `release-gate`, and the dry-run boundary. Sources: [skipped required
  checks report success](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks),
  [the `github` context in a called workflow is the caller's](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

### Releases that change visual baselines

The release run includes `visual-baseline-reach`, so a release commit that
deletes baseline images cannot pass. Push the release state to a branch first,
let "Generate visual baselines" fill in the missing images there, then
fast-forward `main` to that branch head. The bootstrap never runs on `main`: it
ignores pushes to `main` and refuses a dispatch that targets it, because a
commit it pushed there would trigger no workflow and so carry no tests. If `main`
still lacks images, fill them in on a branch off `main` and bring that branch
back; release with a manual dispatch of `release.yml` if `VERSION` did not change
in that push.

### Re-running a red release

"Re-run failed jobs" continues the same run at the same commit: the called test
matrix, the artifact jobs that waited for it and `release-manifest` run again,
and `release-manifest` re-checks the `main` head and the version tag first. The
publisher re-checks both once more. A re-run uses the privileges of the actor who
first triggered the run; for a release that is the person who pushed or
dispatched, which is no problem here, but it is the reason a re-run cannot
widen what a job may do. Re-runs end after 30 days and after 50 attempts.

### Orphaned hand-off images

A release run that fails after its image jobs leaves
`build-<run>-<attempt>-<sha>` images in the registry, for example when two runs
for different commits overlap and the older one stops at the head check. They
are harmless: no tag or release points at them. CI does not delete them, because
that would need delete permission on packages in a workflow. To list and remove
them by hand:

```bash
gh api "/users/<owner>/packages/container/quiltor/versions" --paginate \
  --jq '.[] | select(any(.metadata.container.tags[]; startswith("build-"))) | [.id, .metadata.container.tags[0]] | @tsv'
gh api -X DELETE "/users/<owner>/packages/container/quiltor/versions/<id>"
```

Use `/orgs/<owner>/…` for an organization, and the same for `quiltor-backup`.
This repository's owner is a user account, so `/orgs/…` answers 404 here. The
`/users/…` path is right, but the token needs `read:packages` to list and
`delete:packages` to delete (`gh auth refresh -s read:packages,delete:packages`).
Never delete a version whose tag is a release version or `latest`.

### Release gate scope

In `release.yml` the portable gate runs as `--ci-release-scope` and nothing else
may use the flag; locally, and in `npm run set-version`, the preflight always
runs every step. The flag refuses to run outside `release.yml` on GitHub Actions.

### Publishing

`release-publish.yml` starts with a read-only `select` job. Only a successful
`main` run of Release Build that built a `release-manifest` artifact is
published; a push without a version change has none and is skipped. A manual
dispatch for a run without a manifest is an error. The publish job needs
`select`, so it cannot run on any other path. A second run for a version that is
already released stops at the existing checks: a published release, or a draft
that points at another revision, is refused before anything is promoted.

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

CI and local release preflight use the exact `releaseToolchains` declared in
`distribution/toolchains.json`; the matching dotfiles and `rust-toolchain.toml`
make the same choice outside CI. `npm run doctor` checks installed versions;
`distribution/tooling/workflow_contract.py check` checks the corresponding source-controlled pins.
Release packaging uses `build==1.5.0`, `editables==0.5`, `hatchling==1.31.0`,
`pyinstaller==6.22.0` and `ruff==0.16.4`; package builds disable build isolation
after installing those exact tools. This is a build-tool contract, not a
generic target-runtime claim. Native targets use the declared release CPython; the web
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

The self-hosted image reads `webRuntime.reference` from the committed
`distribution/containers/base-images.json` lock. It must match
`ubuntu:24.04@sha256:<64 lowercase hex>`; a floating or differently versioned
base image stops the build before Docker runs. The backup Python base is checked
against the same lock before its build. The web build overlays the exact Node.js
22.23.2 binary and asserts the effective version against `releaseToolchains`;
its shared base asserts the target CPython 3.12.3 runtime, and the final image
contains only Playwright's Chromium Headless Shell. The extracted browser tree
must match the SHA-256 lock in `distribution/containers/browser-payloads.json`
before that payload can enter the runtime image.
After the pushed digest is bound, the release also measures the `linux/amd64`
runtime config plus its unique compressed layers and fails closed above the
committed 550 MiB budget in
`distribution/containers/image-size-budgets.json`; provenance and SBOM
attestations are not counted as runtime payload.

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

## llama-server conformance

`llama-conformance.yml` runs the local-AI conformance suite against a real
llama-server. It is the only workflow that downloads a llama-server binary and a
model; it is not a required check and no release reads its result. It has three
triggers: a manual dispatch, `workflow_call` (so another workflow can offer it as
an optional job), and a pull request that touches the manifest, `llamacpp.py`,
`shared/contract.py`, the suite or its own files. It reads the repository only and
uses no secret. Its first run of a new model needs the `spike` input, which allows
a model whose SHA-256 is not pinned yet and prints the digest to pin. How the job
grades a run, the model candidates and the known deviations per llama.cpp release
are in [docs/architecture/local-ai-conformance.md](../../docs/architecture/local-ai-conformance.md).
