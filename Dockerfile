# Quiltor — web-demo image (Keycloak login + per-user worlds; see README's
# "Web-Demo mit Keycloak" section for required environment variables).
#
# Built on Microsoft's official Playwright image rather than a plain Python
# base: /api/book.pdf renders through a real headless Chromium at *runtime*
# (src/quiltor/resources/sidecars/pdf/render-book-pdf.mjs), not just at build
# time, so Node,
# Playwright, and Chromium's system libraries all need to be present in the
# final image, not only during `npm run build`. Re-resolving Playwright's
# Debian dependency chain by hand on top of python:slim is fragile; letting
# apt layer Python onto Playwright's already-correct image is not. Playwright's
# image deliberately follows a Node major; Quiltor overlays the exact shared
# Node toolchain from the separately digest-locked official Node image.
ARG PLAYWRIGHT_BASE_IMAGE=mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
ARG NODE_BASE_IMAGE=node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_BASE_IMAGE} AS node-runtime

ARG NODE_BASE_IMAGE
RUN test "$NODE_BASE_IMAGE" = \
    "node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436" \
    && test "$(node --version)" = "v22.23.2" \
    && test "$(npm --version)" = "10.9.8"

FROM ${PLAYWRIGHT_BASE_IMAGE} AS playwright-base

ARG PLAYWRIGHT_BASE_IMAGE
RUN test "$PLAYWRIGHT_BASE_IMAGE" = \
    "mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48"

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY distribution/toolchains.json /tmp/quiltor-toolchains.json
RUN node -e "const t=require('/tmp/quiltor-toolchains.json').releaseToolchains; const npm=require('/usr/local/lib/node_modules/npm/package.json').version; if (process.versions.node !== t.node || npm !== t.npm) throw new Error('Node/npm toolchain drift')" \
    && rm /tmp/quiltor-toolchains.json

FROM playwright-base AS web-build

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && python3 -c "import platform; assert platform.python_version() == '3.12.3', platform.python_version()" \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# The production build includes architecture/design/i18n gates, so the builder
# receives the complete source tree. The runtime stage below copies only what
# the web host and PDF renderer execute.
COPY . .
RUN npm run build
RUN python3 distribution/tooling/profile_contract.py materialize web-self-hosted \
      --output /build/quiltor-build-profile.json

FROM playwright-base AS runtime-node

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /runtime
COPY distribution/web/self-hosted/package.json \
  distribution/web/self-hosted/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
RUN node -e "const lock=require('./package-lock.json'); const p=lock.packages; if (JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(['','node_modules/playwright','node_modules/playwright-core'])) process.exit(1); for (const n of ['node_modules/playwright','node_modules/playwright-core']) if (p[n].version !== '1.61.1' || !String(p[n].integrity).startsWith('sha512-')) process.exit(1)"

FROM playwright-base

# Pass --build-arg QUILTOR_VERSION=$(cat VERSION) so the LABEL below matches the
# image tag; see the "docker build" command documented in the README.
ARG QUILTOR_VERSION=dev
ARG QUILTOR_REVISION=unknown

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv git \
    && python3 -c "import platform; assert platform.python_version() == '3.12.3', platform.python_version()" \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin quiltor

COPY distribution/web/self-hosted/requirements.lock /tmp/quiltor-requirements.lock
RUN python3 -m venv /opt/quiltor-venv \
    && /opt/quiltor-venv/bin/pip install --no-cache-dir \
      --require-hashes \
      --requirement /tmp/quiltor-requirements.lock \
    && /opt/quiltor-venv/bin/python -c "import jwt, cryptography; assert tuple(map(int, jwt.__version__.split('.')[:2])) >= (2, 13)"

ENV PATH="/opt/quiltor-venv/bin:${PATH}"

WORKDIR /app

COPY --from=web-build /build/dist ./dist
COPY --from=runtime-node /runtime/node_modules ./node_modules
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
ENV PYTHONPATH=/app/src

# Run as a non-root user: this container handles session cookies and OIDC secrets.
# /data must be owned by that user *before* VOLUME is declared, since Docker seeds a
# freshly created volume's ownership from whatever is at that path in the image.
RUN mkdir -p /data && chown -R quiltor:quiltor /app /data
USER quiltor

VOLUME ["/data"]
EXPOSE 8000

# --no-open is mandatory here: webbrowser.open() has nothing to open in a container.
CMD ["python3", "apps/web/server.py", "8000", "--no-open"]
