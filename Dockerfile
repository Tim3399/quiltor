# Quiltor — web-demo image (Keycloak login + per-user worlds; see README's
# "Web-Demo mit Keycloak" section for required environment variables).
#
# Built on Microsoft's official Playwright image rather than a plain Python
# base: /api/book.pdf renders through a real headless Chromium at *runtime*
# (backend/scripts/render-book-pdf.mjs), not just at build time, so Node,
# Playwright, and Chromium's system libraries all need to be present in the
# final image, not only during `npm run build`. Re-resolving Playwright's
# Debian dependency chain by hand on top of python:slim is fragile; letting
# apt layer Python onto Playwright's already-correct image is not.
FROM mcr.microsoft.com/playwright:v1.62.0-noble

# Pass --build-arg QUILTOR_VERSION=$(cat VERSION) so the LABEL below matches the
# image tag; see the "docker build" command documented in the README.
ARG QUILTOR_VERSION=dev

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts playwright.config.ts index.html ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

COPY backend ./backend
COPY server.py VERSION ./

# VERSION (baked into the image, read by server.py) is the single source of
# truth; this LABEL just mirrors it for `docker inspect`/registry tooling.
LABEL org.opencontainers.image.version="${QUILTOR_VERSION}"

# QUILTOR_HOST=0.0.0.0: a container's loopback interface isn't reachable through
# Docker's port forwarding at all (unlike plain `python3 server.py`, which binds
# 127.0.0.1 on purpose) — the reverse proxy in front of this container is what
# actually restricts who can reach it.
ENV QUILTOR_HOST=0.0.0.0
ENV QUILTOR_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000

# --no-open is mandatory here: webbrowser.open() has nothing to open in a container.
CMD ["python3", "server.py", "8000", "--no-open"]
