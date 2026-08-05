# App-layer image only. The GPU-bound local model runs NATIVELY on the host -- Docker on Apple
# Silicon has no Metal passthrough, so inference is never containerised here. Point the app at a
# native (or ai-relay) inference endpoint with QUILTOR_AI_URL / QUILTOR_EMBED_URL. See
# docs/deployment.md. The backend is standard-library only, so this image carries no Python deps.
#
# Build the frontend first so dist/ exists:  npm run build
# Then:  docker build -t quiltor .
# Run:   docker run -p 8000:8000 -v quiltor-data:/data \
#          -e QUILTOR_AI_URL=http://host.docker.internal:11435 quiltor
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY backend ./backend
COPY mcp ./mcp
COPY scripts ./scripts
COPY dist ./dist
COPY server.py ./
RUN pip install --no-cache-dir .

# World data lives on a volume; the model runtime is external, so no runtime/ or models/ here.
ENV QUILTOR_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000

# QUILTOR_AI_URL (and optionally QUILTOR_EMBED_URL) must be supplied at run time.
CMD ["quiltor", "run", "8000", "--no-open"]
