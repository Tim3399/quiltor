# Quiltor — web-demo image (Keycloak login + per-user worlds; see README's
# "Web-Demo mit Keycloak" section for required environment variables).
#
# /api/book.pdf renders through Playwright at runtime, but it only needs the
# headless Chromium shell. The general-purpose Playwright image also ships full
# Chromium, Firefox and WebKit in one ~790 MB compressed layer, so using it as
# the runtime base makes every Quiltor pull pay for three unused browsers.
# Instead, start from digest-locked Ubuntu, install Playwright's reviewed
# Chromium dependency set, and download only the matching headless shell from
# the exact lockfile-pinned Playwright package.
ARG WEB_RUNTIME_BASE_IMAGE=ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517
ARG NODE_BASE_IMAGE=node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_BASE_IMAGE} AS node-runtime

ARG NODE_BASE_IMAGE
RUN test "$NODE_BASE_IMAGE" = \
    "node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436" \
    && test "$(node --version)" = "v22.23.2" \
    && test "$(npm --version)" = "10.9.8"

FROM ${WEB_RUNTIME_BASE_IMAGE} AS web-runtime-base

ARG WEB_RUNTIME_BASE_IMAGE
RUN test "$WEB_RUNTIME_BASE_IMAGE" = \
    "ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates libgomp1 libstdc++6 python3 python3-venv \
    && python3 -c "import platform; assert platform.python_version() == '3.12.3', platform.python_version()" \
    && rm -rf /var/lib/apt/lists/*

FROM web-runtime-base AS web-build

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY distribution/toolchains.json /tmp/quiltor-toolchains.json
RUN node -e "const t=require('/tmp/quiltor-toolchains.json').releaseToolchains; const npm=require('/usr/local/lib/node_modules/npm/package.json').version; if (process.versions.node !== t.node || npm !== t.npm) throw new Error('Node/npm toolchain drift')" \
    && rm /tmp/quiltor-toolchains.json

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

# The production build includes architecture/design/i18n gates, so the builder
# receives the complete source tree. The runtime stage below copies only what
# the web host and PDF renderer execute.
COPY . .
RUN npm run build
RUN python3 distribution/tooling/profile_contract.py materialize web-self-hosted \
      --output /build/quiltor-build-profile.json

FROM node-runtime AS runtime-node

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /runtime
COPY distribution/web/self-hosted/package.json \
  distribution/web/self-hosted/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
RUN node -e "const lock=require('./package-lock.json'); const p=lock.packages; if (JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(['','node_modules/playwright','node_modules/playwright-core'])) process.exit(1); for (const n of ['node_modules/playwright','node_modules/playwright-core']) if (p[n].version !== '1.61.1' || !String(p[n].integrity).startsWith('sha512-')) process.exit(1)"

FROM web-runtime-base AS playwright-browser

ARG TARGETARCH
RUN test "$TARGETARCH" = "amd64"

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /runtime
COPY --from=runtime-node /runtime/node_modules ./node_modules
COPY distribution/containers/browser-payloads.json /tmp/quiltor-browser-payloads.json
COPY distribution/tooling/browser_payload_digest.py /tmp/browser_payload_digest.py

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright/cli.js install --only-shell chromium \
    && chmod -R a+rX /ms-playwright \
    && python3 /tmp/browser_payload_digest.py check-contract /ms-playwright \
      --contract /tmp/quiltor-browser-payloads.json \
      --platform linux/amd64 \
      --playwright-version 1.61.1 \
    && test -x "$(find /ms-playwright/chromium_headless_shell-* -type f \( -name chrome-headless-shell -o -name headless_shell \) -print -quit)" \
    && test -z "$(find /ms-playwright -maxdepth 1 -type d \( -name 'firefox-*' -o -name 'webkit-*' -o -name 'chromium-[0-9]*' \) -print -quit)"

FROM web-runtime-base

# Pass --build-arg QUILTOR_VERSION=$(cat VERSION) so the LABEL below matches the
# image tag; see the "docker build" command documented in the README.
ARG QUILTOR_VERSION=dev
ARG QUILTOR_REVISION=unknown

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=runtime-node /runtime/node_modules ./node_modules
COPY --from=playwright-browser \
  /ms-playwright/chromium_headless_shell-1228 \
  /ms-playwright/chromium_headless_shell-1228

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright/cli.js install-deps chromium \
    && rm -rf /var/lib/apt/lists/*
RUN test -x "$(find /ms-playwright/chromium_headless_shell-* -type f \( -name chrome-headless-shell -o -name headless_shell \) -print -quit)" \
    && test -z "$(find /ms-playwright -maxdepth 1 -type d \( -name 'ffmpeg-*' -o -name 'firefox-*' -o -name 'webkit-*' -o -name 'chromium-[0-9]*' \) -print -quit)"

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN useradd --create-home --shell /usr/sbin/nologin quiltor

COPY distribution/web/self-hosted/requirements.lock /tmp/quiltor-requirements.lock
RUN python3 -m venv /opt/quiltor-venv \
    && /opt/quiltor-venv/bin/pip install --no-cache-dir \
      --require-hashes \
      --requirement /tmp/quiltor-requirements.lock \
    && /opt/quiltor-venv/bin/python -c "import jwt, cryptography; assert tuple(map(int, jwt.__version__.split('.')[:2])) >= (2, 13)"

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
ENV PATH="/opt/quiltor-venv/bin:${PATH}"

COPY --from=web-build /build/dist ./dist
COPY src ./src
COPY apps/web/server.py ./apps/web/server.py
COPY VERSION ./VERSION
COPY LICENSE THIRD-PARTY-NOTICES.md ./
COPY --from=web-build /build/quiltor-build-profile.json \
  ./src/quiltor/infrastructure/platform/quiltor-build-profile.json
RUN python3 -c "import json; p=json.load(open('src/quiltor/infrastructure/platform/quiltor-build-profile.json')); assert p['id']=='web-self-hosted'"
RUN PYTHONPATH=/app/src python3 -c "from quiltor.modules.identity.auth import verify_id_token; import jwt, cryptography; assert callable(verify_id_token)"

# VERSION (baked into the image, read by the web host) is the single source of
# truth; this LABEL just mirrors it for `docker inspect`/registry tooling.
LABEL org.opencontainers.image.source="https://github.com/Tim3399/quiltor" \
      org.opencontainers.image.version="${QUILTOR_VERSION}" \
      org.opencontainers.image.revision="${QUILTOR_REVISION}" \
      org.quiltor.role="web-application"

# QUILTOR_HOST=0.0.0.0: a container's loopback interface isn't reachable through
# Docker's port forwarding at all (unlike the source bootstrap, which binds
# 127.0.0.1 on purpose) — the reverse proxy in front of this container is what
# actually restricts who can reach it.
ENV QUILTOR_HOST=0.0.0.0
ENV QUILTOR_DATA_DIR=/data
# The assistant installs a llama.cpp runtime and downloads a multi-gigabyte model
# into QUILTOR_HOME. Left at its default that root is /app, which lives in the
# image layer: a `docker compose up --force-recreate` or any image update throws
# both away and the user downloads them again. Inside the volume they survive.
# Worlds are unaffected -- QUILTOR_DATA_DIR is set explicitly and wins outright.
ENV QUILTOR_HOME=/data/assistant
ENV PYTHONPATH=/app/src
# Python block-buffers stdout when it is a pipe rather than a terminal, so
# anything the process prints reaches `docker logs` only once 8 KB have piled
# up -- which, for a download that is stuck or about to fail, is never. The
# assistant installer is the loudest thing in here and the one most worth
# watching, so trade the buffer for a log that keeps up.
ENV PYTHONUNBUFFERED=1

# Run as a non-root user: this container handles session cookies and OIDC secrets.
# /data must be owned by that user *before* VOLUME is declared, since Docker seeds a
# freshly created volume's ownership from whatever is at that path in the image.
RUN mkdir -p /data/assistant && chown -R quiltor:quiltor /app /data
USER quiltor

# Exercise the exact production path as the unprivileged runtime user. This
# catches missing shared libraries and accidental full-browser installs while
# the image is still being built.
RUN node -e "const {chromium}=require('playwright'); (async()=>{const browser=await chromium.launch({headless:true}); try { const page=await browser.newPage(); await page.setContent('<main>Quiltor PDF smoke</main>'); const pdf=await page.pdf(); if (pdf.subarray(0,5).toString() !== '%PDF-') throw new Error('invalid PDF smoke output'); } finally { await browser.close(); }})().catch(error=>{console.error(error); process.exit(1)})"

VOLUME ["/data"]
EXPOSE 8000

# --no-open is mandatory here: webbrowser.open() has nothing to open in a container.
CMD ["python3", "apps/web/server.py", "8000", "--no-open"]
