# Third-party notices

Quiltor's own source is licensed as described in [LICENSE](LICENSE). This file
covers third-party software and model weights distributed alongside it. Their
licenses are independent of Quiltor's and are not affected by it — in
particular, the Apache-2.0 license on the bundled model applies only to the
model weights, not to Quiltor's source code, and Quiltor's license does not
apply to the model.

## Bundled at setup time (`runtime/`, `models/` — not committed to Git)

`src/quiltor/infrastructure/inference/installer.py` downloads these on demand —
either automatically on first launch of `apps/web/server.py`, or explicitly via
`PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer`; they ship in release packages.

- **llama.cpp** (`llama-server` / `llama-server.exe` and its `ggml*`/`llama*`
  libraries) — MIT License. Copyright (c) 2023-2026 The ggml authors.
  <https://github.com/ggml-org/llama.cpp>
- **Qwen3-4B** (`Qwen3-4B-Q4_K_M.gguf`) — Apache License 2.0.
  <https://huggingface.co/Qwen/Qwen3-4B-GGUF>
- **MLX** (Apple Silicon only, `runtime/mlx-venv/`) — `mlx` and `mlx-lm`,
  MIT License, <https://github.com/ml-explore/mlx>,
  <https://github.com/ml-explore/mlx-lm>; **llguidance**, MIT License,
  <https://github.com/guidance-ai/llguidance>.
- **Qwen3-4B, MLX quantization** (`models/mlx/Qwen3-4B-4bit/`, Apple Silicon
  only) — Apache License 2.0. <https://huggingface.co/mlx-community/Qwen3-4B-4bit>

## Bundled in the built client (`dist/`, committed to Git)

This is the complete production dependency closure from `package-lock.json`.
Development-only test and build packages are not shipped in `dist/`.

| Package                      | Version | License      |
| ---------------------------- | ------- | ------------ |
| `@codemirror/state`          | 6.7.1   | MIT          |
| `@codemirror/view`           | 6.43.8  | MIT          |
| `@marijn/find-cluster-break` | 1.0.3   | MIT          |
| `@types/d3-color`            | 3.1.3   | MIT          |
| `@types/d3-drag`             | 3.0.7   | MIT          |
| `@types/d3-interpolate`      | 3.0.4   | MIT          |
| `@types/d3-selection`        | 3.0.11  | MIT          |
| `@types/d3-transition`       | 3.0.9   | MIT          |
| `@types/d3-zoom`             | 3.0.8   | MIT          |
| `@xyflow/react`              | 12.11.2 | MIT          |
| `@xyflow/system`             | 0.0.79  | MIT          |
| `classcat`                   | 5.0.5   | MIT          |
| `crelt`                      | 1.0.7   | MIT          |
| `d3-color`                   | 3.1.0   | ISC          |
| `d3-dispatch`                | 3.0.1   | ISC          |
| `d3-drag`                    | 3.0.0   | ISC          |
| `d3-ease`                    | 3.0.1   | BSD-3-Clause |
| `d3-interpolate`             | 3.0.1   | ISC          |
| `d3-selection`               | 3.0.0   | ISC          |
| `d3-timer`                   | 3.0.1   | ISC          |
| `d3-transition`              | 3.0.1   | ISC          |
| `d3-zoom`                    | 3.0.0   | ISC          |
| `lucide-react`               | 1.27.0  | ISC          |
| `react`                      | 19.2.8  | MIT          |
| `react-dom`                  | 19.2.8  | MIT          |
| `scheduler`                  | 0.27.0  | MIT          |
| `style-mod`                  | 4.1.3   | MIT          |
| `use-sync-external-store`    | 1.6.0   | MIT          |
| `w3c-keyname`                | 2.2.8   | MIT          |
| `zustand`                    | 4.5.7   | MIT          |

Copyright and full license texts are available from the respective npm package
metadata and repositories. CodeMirror is copyright (c) 2018-2021 Marijn
Haverbeke and others; React, React DOM and Scheduler include copyrights held by
Meta Platforms, Inc. and affiliates.

## Bundled in application runtimes

- **Microsoft Playwright for Python 1.61.0** — Apache License 2.0; portions
  copyright Microsoft Corporation and Google Inc. It is the optional,
  exactly-pinned `browser-pdf` dependency for installed Python packages and
  drives a separately installed system Chrome or Edge browser.
- **Microsoft Playwright 1.61.1** — Apache License 2.0; portions copyright
  Microsoft Corporation and Google Inc. The self-hosted OCI image is based on
  `mcr.microsoft.com/playwright:v1.61.1-noble` at the exact digest recorded in
  `distribution/containers/base-images.json`, and therefore also contains the
  Ubuntu and browser components supplied by that image under their respective
  licenses. Their component notices remain available in the base image.
- **PyJWT 2.13.0** — MIT License. Copyright (c) 2015-2022 José Padilla. It is
  included in the self-hosted image and resolved as a core Python dependency
  for packaged hosts.
- **cryptography 50.0.0** — dual-licensed under Apache License 2.0 or the
  3-Clause BSD License. It is the cryptographic implementation installed by
  PyJWT's `crypto` extra in the self-hosted image and packaged hosts.
- **cffi 2.1.1** — MIT No Attribution (`MIT-0`) License, and **pycparser 3.0**
  — 3-Clause BSD License. Both are pinned transitive dependencies of the
  self-hosted cryptography runtime.

### Hash-locked Python build and runtime closure

The following table is the union of the reviewed build/bootstrap, macOS arm64,
Windows x86_64 and web OCI lock files. A package is only installed for the
targets whose resolved graph requires it; listing the union here keeps every
signed native artifact and OCI dependency auditable from one bundled document.

| Package                                   | Version     | License                                    |
| ----------------------------------------- | ----------- | ------------------------------------------ |
| `altgraph`                                | 0.17.5      | MIT                                        |
| `annotated-doc`                           | 0.0.5       | MIT                                        |
| `bottle`                                  | 0.13.4      | MIT                                        |
| `cffi`                                    | 2.1.1       | MIT-0                                      |
| `clr-loader`                              | 0.3.1       | MIT                                        |
| `colorama`                                | 0.4.6       | BSD-3-Clause                               |
| `cryptography`                            | 50.0.0      | Apache-2.0 OR BSD-3-Clause                 |
| `hatchling`                               | 1.31.0      | MIT                                        |
| `macholib`                                | 1.16.4      | MIT                                        |
| `markdown-it-py`                          | 4.2.0       | MIT                                        |
| `mdurl`                                   | 0.1.2       | MIT                                        |
| `packaging`                               | 26.3        | Apache-2.0 OR BSD-2-Clause                 |
| `pathspec`                                | 1.1.1       | MPL-2.0                                    |
| `pefile`                                  | 2024.8.26   | MIT                                        |
| `pillow`                                  | 12.3.0      | MIT-CMU                                    |
| `pluggy`                                  | 1.6.0       | MIT                                        |
| `proxy-tools`                             | 0.1.0       | MIT                                        |
| `pycparser`                               | 3.0         | BSD-3-Clause                               |
| `pygments`                                | 2.21.0      | BSD-2-Clause                               |
| `pyinstaller`                             | 6.22.0      | GPL-2.0-or-later WITH Bootloader-exception |
| `pyinstaller-hooks-contrib`               | 2026.6      | Apache-2.0 OR GPL-2.0                      |
| `pyjwt`                                   | 2.13.0      | MIT                                        |
| `pyobjc-core`                             | 12.2.2      | MIT                                        |
| `pyobjc-framework-cocoa`                  | 12.2.2      | MIT                                        |
| `pyobjc-framework-quartz`                 | 12.2.2      | MIT                                        |
| `pyobjc-framework-security`               | 12.2.2      | MIT                                        |
| `pyobjc-framework-uniformtypeidentifiers` | 12.2.2      | MIT                                        |
| `pyobjc-framework-webkit`                 | 12.2.2      | MIT                                        |
| `pystray`                                 | 0.19.5      | LGPL-3.0                                   |
| `pythonnet`                               | 3.1.0       | MIT                                        |
| `pywebview`                               | 6.2.1       | BSD-3-Clause                               |
| `pywin32-ctypes`                          | 0.2.3       | BSD-3-Clause                               |
| `rich`                                    | 15.0.0      | MIT                                        |
| `setuptools`                              | 84.0.0      | MIT                                        |
| `shellingham`                             | 1.5.4       | ISC                                        |
| `six`                                     | 1.17.0      | MIT                                        |
| `trove-classifiers`                       | 2026.6.1.19 | Apache-2.0                                 |
| `typer`                                   | 0.27.1      | MIT                                        |
| `typing-extensions`                       | 4.16.0      | PSF-2.0                                    |
| `wheel`                                   | 0.48.0      | MIT                                        |

The npm names, versions and SPDX expressions above are recorded in
`package-lock.json`. The OCI Python versions are recorded in
`distribution/web/self-hosted/requirements.lock`; native and bootstrap locks
are recorded in `distribution/dependency-locks.json`, including their SHA-256
digests and exact target Python environments. Package license files installed
in `.dist-info/licenses/` metadata remain authoritative where a project exposes
multiple license choices. Release artifacts include this notice together with
Quiltor's `LICENSE`.

## Optional local writing data (`data/writing-assistance/`, installed on demand)

- **LanguageTool 6.6** — LGPL-2.1-or-later, downloaded from
  <https://languagetool.org/>. Quiltor verifies the archive checksum before extraction.
- **German Wiktionary data** — CC BY-SA 4.0 / GFDL; German-language Wiktionary,
  machine-readable extraction by Wiktextract/Kaikki.org.
- **OpenThesaurus** — CC BY-SA 4.0, <https://www.openthesaurus.de/>.
- **FreeDict deu-eng and eng-deu dictionaries** — GPL according to the respective
  dictionary TEI header, <https://freedict.org/>.

The exact upstream version, URL, checksum, license label, and attribution used by
the installer are recorded in `src/quiltor/modules/writing_assistance/registry.py`. These datasets are
not committed to Git and are not covered by Quiltor's own license.

## A note on `libomp140.x86_64.dll`

The Windows `llama-server` runtime bundle includes `libomp140.x86_64.dll` (an
LLVM OpenMP runtime redistributable). If you build or repackage the runtime
yourself, verify its license and redistribution terms for your use case
before distributing it further.
