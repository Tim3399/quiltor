"""Short-lived, single-use tokens that let a headless render act as the
requesting user for exactly one page load.

The hosted deployment is what needs them: the render runs in a separate browser
process with no cookie of its own, and it cannot do an interactive Keycloak
login. A single-user instance would usually recognise that process anyway --
it connects over loopback -- but the token path is common to both identities
rather than conditional, so the render URL is built the same way everywhere.
The renderers know none of this; they carry whatever URL they are given.
"""

from __future__ import annotations

import secrets
import threading
import time

RENDER_TOKEN_TTL = 90

_lock = threading.Lock()
_tokens: dict[str, tuple[str, float]] = {}


def issue_render_token(sub: str) -> str:
    token = secrets.token_urlsafe(24)
    now = time.time()
    with _lock:
        for key in [k for k, (_, expires) in _tokens.items() if expires < now]:
            _tokens.pop(key, None)
        _tokens[token] = (sub, now + RENDER_TOKEN_TTL)
    return token


def redeem_render_token(token: str) -> str | None:
    with _lock:
        entry = _tokens.pop(token, None)
    if entry and entry[1] > time.time():
        return entry[0]
    return None
