"""Which distribution of Quiltor this process is running as.

Two builds exist, and they differ in what macOS lets them do rather than in what
they are for:

  - "devid" -- the Developer ID build shipped as a .dmg (and the Windows/Linux/
    Docker/source cases, which have no such distinction). Full filesystem access,
    may download and run a local LLM runtime. This is the default everywhere.
  - "store" -- a sandboxed Mac App Store build.

App Store guideline 2.5.2 forbids downloading *executable code*; it does not
forbid downloading *data*, so model weights stay a download either way (they have
to -- the Store caps an app at 4 GB and the weights alone are ~2.5 GB). What has
to change in a Store build is narrow, and every place that cares asks here:

  - backend/llm/installer.py -- ships llama-server inside the app bundle instead
    of fetching it from GitHub releases.
  - backend/llm/select.py -- skips the MLX backend, whose installer builds a venv
    and pip-installs into it at runtime, i.e. exactly what 2.5.2 prohibits.

Standard library only, like the rest of backend/: server.py has to keep working
without the optional desktop extra installed.
"""
from __future__ import annotations

import os

DEVID = "devid"
STORE = "store"
EDITIONS = (DEVID, STORE)


def edition() -> str:
    override = os.environ.get("QUILTOR_EDITION", "").strip().casefold()
    if override:
        if override not in EDITIONS:
            raise SystemExit(f"Unknown QUILTOR_EDITION={override!r}. Expected one of: {', '.join(EDITIONS)}")
        return override
    # macOS exports APP_SANDBOX_CONTAINER_ID into every sandboxed process, and the
    # App Sandbox is mandatory for Store apps -- so its presence is the signal, and
    # one build can behave correctly in either context without a compile-time flag.
    # The override above still exists for testing the Store code paths on a normal
    # checkout, where no sandbox is involved.
    if os.environ.get("APP_SANDBOX_CONTAINER_ID"):
        return STORE
    return DEVID


def is_store_build() -> bool:
    return edition() == STORE
