"""Short-lived, single-use tokens that let a headless render act as the
requesting user for exactly one page load.

Only the hosted deployment needs these: the render runs in a separate browser
process that cannot do an interactive Keycloak login of its own. The desktop
build has no authentication at all, so nothing here is reached there -- but the
renderers do not need to know that, they just carry whatever URL they are given.
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
