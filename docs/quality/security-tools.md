# Security tools

Tools used once for the security audit before 3.26 (T-268 to T-271), outside the pinned
toolchain. None of them is part of `npm run check`, CI, `distribution/toolchains.json`,
`package.json` or any requirements file. They are kept here so the next audit starts from
known versions, hashes and false positives instead of from scratch.

Rules that applied to every run (decisions D-192, D-195):

- Official release binaries only, no Docker image and no GitHub Action variant.
- SHA-256 checked against the checksum file of the same release before first use; trivy also
  through Sigstore, because trivy 0.69.4 to 0.69.6 were compromised releases.
- Stored under `F:/ai/Tools/<tool>-<version>/`, outside every repository.
- Read-only runs. Reports that may contain secret values stay in a scratch directory;
  findings are recorded by location and rule only, never by value.
- Anything that downloads more (vulnerability databases, image layers, pip packages) needs
  an explicit release first.

Each section ends with a proposal: **blocking** (worth a gate), **reporting** (worth an
occasional run), or **not needed**.

## T-269: client, desktop and supply chain

Audited revision `8d9b0d22` (`agent-team-einrichtung`) and `7fcf7993` (`int/T-61`),
2026-11-13. Report: `implementer/T-269-audit-supply.md` in the team knowledge base.

### gitleaks 8.30.1

- **Source:** `github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip`
- **SHA-256:** zip `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`, matches
  `gitleaks_8.30.1_checksums.txt`; `gitleaks.exe`
  `17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c`, identical to the copy in
  the zip.
- **Command:** `gitleaks git . --redact=100 --report-format json --report-path <scratch>/gitleaks.json --log-opts=8d9b0d22`
- **Runtime:** 12 s for 1002 commits, about 203 MB.
- **Result:** 5 `generic-api-key` hits, all false positives:
  - `tests/python/test_server_log_privacy.py:44-57` -- the canary values of the log
    privacy test, letters and digits on purpose.
  - `tools/evaluation/browser-inference/schema_fidelity.py:46` -- the SHA-256 of a tokenizer
    file.
- **Proposal:** reporting. A blocking gate would need an allowlist for the two files first
  (`.gitleaks.toml`); GitHub secret scanning and push protection are already on.

### trivy 0.76.2

- **Source:** `github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_windows-64bit.zip`,
  `trivy_0.76.2_checksums.txt`, `trivy_0.76.2_checksums.txt.sigstore.json`
- **SHA-256:** zip `691f737a7e5566a673c3a74dab9160552ec32101e953b659e5c77443d16dddb6`, matches
  the checksum file; `trivy.exe` `dd07adf881a72b54d1a922191d62fa939938df2155be85a727da93b67b24e617`.
- **Sigstore:** `cosign verify-blob --bundle trivy_0.76.2_checksums.txt.sigstore.json
--certificate-identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.2
--certificate-oidc-issuer https://token.actions.githubusercontent.com trivy_0.76.2_checksums.txt`
  -> `Verified OK`.
- **Command:** `trivy fs --cache-dir <tools>/trivy-0.76.2/cache --scanners secret,misconfig
--skip-db-update --skip-check-update --offline-scan --format json <export>`, where
  `<export>` is `git archive <commit>` unpacked into a scratch directory -- no checkout.
- **Runtime:** 16 s (`8d9b0d22`), 7 s (`7fcf7993`).
- **Result:** only `DS-0026` (LOW, no `HEALTHCHECK`) on `Dockerfile` and
  `services/backup-server/Dockerfile`. An operations question; the compose stack has its own
  health checks.
- **Vulnerability database:** `trivy image --download-db-only --cache-dir <tools>/trivy-0.76.2/cache`
  fetched `mirror.gcr.io/aquasec/trivy-db:2` (133.8 MiB, 27 s; updated 2026-11-13 12:56 UTC).
- **Vulnerability scan:** `trivy fs --cache-dir <tools>/trivy-0.76.2/cache --scanners vuln
--skip-db-update --offline-scan --format json <export>` on both exports, under 1 s each:
  `package-lock.json`, `distribution/web/self-hosted/package-lock.json` and `Cargo.lock`, 0
  vulnerabilities. trivy does not recognise the Python locks, whose names end in `.lock`;
  pip-audit covers them.
- **Not run:** `trivy image` on the deployed images needs their layers and was not released
  for download. The system packages of the 3.26 image can only be scanned once the release
  build exists.
- **Proposal:** reporting for `config`; `image --scanners vuln` on the release image would be
  worth a blocking gate in `release.yml` once the database download is accepted.

### cosign 3.1.4

- **Source:** `github.com/sigstore/cosign/releases/download/v3.1.4/cosign-windows-amd64.exe`,
  `cosign_checksums.txt`
- **SHA-256:** `cbe953787074611f1334cbf37dc1cf953995bb8c45398eb4fc7bb781d29c1f2a`, matches the
  checksum file.
- **Command:** only the `verify-blob` above.
- **Runtime:** 1.3 s.
- **Side effect:** cosign fetched the Sigstore TUF root from `tuf-repo-cdn.sigstore.dev` into
  `~/.sigstore/root`. `--offline` is deprecated in 3.x; a fully offline check needs
  `--trusted-root <file>`.
- **Proposal:** not needed beyond verifying downloaded tools.

### osv-scanner 2.7.0

- **Source:** `github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_windows_amd64.exe`,
  `osv-scanner_SHA256SUMS`
- **SHA-256:** `9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438`, matches the
  checksum file. `distribution/toolchains.json` pins only the Linux binary; that line of the
  same checksum file equals the pin, which ties the file to the pinned release (S269-112).
- **Command:** `npm run lint:osv` with the directory on `PATH` (the binary copied to
  `osv-scanner.exe`), plus `osv-scanner scan source --config osv-scanner.toml -L
distribution/web/self-hosted/package-lock.json`, and the same lock list on the `7fcf7993`
  export. `osv-scanner.toml` ignores nothing.
- **Runtime:** 9 s, under 1 s, 5 s. Queries osv.dev online.
- **Result:** "No issues found" for all eight locks on both revisions.
- **Proposal:** already blocking in CI; pin the Windows and macOS hashes too.

### pip-audit 2.10.1

- **Source:** PyPI, in its own venv `F:/ai/Tools/pip-audit/venv` (Python 3.12.10).
- **SHA-256:** `pip download --only-binary=:all:` into an empty directory; each of the 29
  wheels compared with the digest from PyPI's JSON API (all matched), then
  `pip install --no-index --require-hashes -r <tools>/pip-audit/requirements.txt`.
- **Command:** `pip-audit --disable-pip --no-deps --progress-spinner off -r <lock>` for the
  four locks of `distribution/dependency-locks.json` and the MLX lock, on both revisions. No
  resolver run, nothing installed from the locks.
- **Runtime:** 1-3 s per lock.
- **Result:** "No known vulnerabilities found" everywhere.
- **Proposal:** reporting; osv-scanner already covers the same locks in CI.

### Tools already present

| Tool       | Version    | Command                                                                                                                                                                            | Runtime  | Result                                                         |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| zizmor     | 1.31.1     | `zizmor --offline --no-progress .github/workflows`                                                                                                                                 | 0.2 s    | no findings (9 ignored by `.github/zizmor.yml`, 52 suppressed) |
| actionlint | 1.7.12     | `actionlint`                                                                                                                                                                       | 0.8 s    | no findings                                                    |
| npm audit  | npm 10.9.8 | `npm audit --package-lock-only [--omit=dev]`, root and `distribution/web/self-hosted`                                                                                              | 7 s each | 0 vulnerabilities                                              |
| gh api     | --         | GET only: repository, branch protection, rulesets, Actions permissions, environments, secret names, Dependabot status. Never `secret-scanning/alerts`, which returns secret values | < 10 s   | see S269-106 to S269-108                                       |

### Not run

- `trivy image` on the deployed images: image pull not released.
- hadolint, cargo-deny, shellcheck: not installed locally (CI runs them).
