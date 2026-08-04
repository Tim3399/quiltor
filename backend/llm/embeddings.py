from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

from backend.llm.runtimes import resolve_port, spawn_logged
from backend.llm.runtimes.llamacpp import binary_name
from backend.llm.shared.contract import check_health, embed as embed_request


class EmbeddingRuntime:
    """Lazily-started local embedding server -- a second llama-server started with
    --embeddings on its own port, serving the OpenAI /v1/embeddings contract.

    Design points:
    - Lazy: nothing starts until the first semantic retrieval actually needs a vector.
      A small embedding model loads in ~1-2s, so paying that once on first use (then
      staying warm) is cheaper than always running a second model.
    - Optional: every failure mode -- no model installed, spawn failed, server down,
      a bad response -- degrades to returning None. The caller reads None as "fall back
      to lexical retrieval", so embeddings are a quality boost and never a hard
      dependency that could take the assistant offline.
    - Configurable: model, pooling and the query/document prefixes some embedding models
      require are all env-overridable, so swapping the model needs no code change. An
      external QUILTOR_EMBED_URL is honoured as-is (never spawns its own process then).
    """

    def __init__(self, base: Path, data: Path):
        self.base, self.data = base, data
        self.url = os.environ.get("QUILTOR_EMBED_URL", "http://127.0.0.1:11436").rstrip("/")
        self.external = bool(os.environ.get("QUILTOR_EMBED_URL"))
        # Defaults match the installer's default model (nomic-embed-text-v1.5: mean pooling
        # and search_query:/search_document: prefixes). A different model overrides all three
        # via env; cosine ranking is scale-invariant, so L2 normalisation isn't needed here.
        self.query_prefix = os.environ.get("QUILTOR_EMBED_QUERY_PREFIX", "search_query: ")
        self.doc_prefix = os.environ.get("QUILTOR_EMBED_DOC_PREFIX", "search_document: ")
        self.pooling = os.environ.get("QUILTOR_EMBED_POOLING", "mean")
        self.process: subprocess.Popen[str] | None = None
        self.log_path: Path | None = None
        self._lock = threading.Lock()
        self._disabled = False

    def model_path(self) -> Path | None:
        override = os.environ.get("QUILTOR_EMBED_MODEL")
        if override:
            candidate = Path(override)
            return candidate if candidate.exists() else None
        folder = self.base / "models" / "embed"
        models = sorted(folder.glob("*.gguf")) if folder.exists() else []
        return models[0] if models else None

    def model_id(self) -> str:
        """Stable identifier for cache-key namespacing; changes when the model changes."""
        if self.external:
            return f"external:{self.url}"
        model = self.model_path()
        return model.name if model else "none"

    def available(self) -> bool:
        return self._ensure_started()

    def _ensure_started(self) -> bool:
        if self._disabled:
            return False
        if check_health(self.url):
            return True
        if self.external:
            return False  # an external endpoint was configured but is not up; never spawn our own
        with self._lock:
            if check_health(self.url):
                return True
            if self.process is None or self.process.poll() is not None:
                binary = self.base / "runtime" / binary_name()
                model = self.model_path()
                if not binary.exists() or model is None:
                    self._disabled = True  # nothing to start; don't retry the spawn every request
                    return False
                port = resolve_port(self.url, 11436)
                argv = [str(binary), "-m", str(model), "--host", "127.0.0.1", "--port", str(port),
                        "--embeddings", "--pooling", self.pooling, "-c", "2048"]
                try:
                    self.process, self.log_path = spawn_logged(argv, self.data, "llama-embed.log")
                except OSError:
                    self._disabled = True
                    return False
        deadline = time.time() + 15
        while time.time() < deadline:
            if check_health(self.url):
                return True
            if self.process is not None and self.process.poll() is not None:
                self._disabled = True  # crashed on startup (e.g. model rejects --embeddings)
                return False
            time.sleep(0.3)
        return check_health(self.url)

    def embed(self, texts: list[str], is_query: bool = False) -> list[list[float]] | None:
        if not texts or not self._ensure_started():
            return None
        prefix = self.query_prefix if is_query else self.doc_prefix
        payload = [prefix + text for text in texts] if prefix else texts
        try:
            return embed_request(self.url, payload)
        except RuntimeError:
            return None

    def status(self) -> dict[str, object]:
        return {"available": check_health(self.url), "model": self.model_id(), "url": self.url}

    def close(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
