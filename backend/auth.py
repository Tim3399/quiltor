"""OIDC (Keycloak) relying-party client and opaque session store for the web demo.

The OIDC half -- discovery, the code exchange, claim checks -- is only active
when QUILTOR_OIDC_ISSUER is set, and OIDC_ENABLED is what backend/identity.py
reads to decide which identity a process gets. The session store below is not
OIDC-specific and both deployments use it: the local identity keeps its one
session here too, because "a request has a session" is true everywhere.

Security model: the authorization `code` is the only OIDC artifact that ever
touches the browser. It is exchanged for tokens via a direct server-to-server
HTTPS call to Keycloak's token endpoint (default, certificate-verified TLS
context — never disable verification here). Because that response never passes
through the browser, the ID token's JWT signature is not independently verified;
only iss/aud/exp claims are checked as a sanity check (see validate_claims). The
browser only ever sees the opaque authorization code and our own opaque session
cookie — never a raw access/ID token.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

ISSUER = os.environ.get("QUILTOR_OIDC_ISSUER", "").rstrip("/")
CLIENT_ID = os.environ.get("QUILTOR_OIDC_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("QUILTOR_OIDC_CLIENT_SECRET", "")
OIDC_ENABLED = bool(ISSUER)

SESSION_TTL = 24 * 60 * 60  # a session cookie is honored for 24h of wall-clock time
PENDING_LOGIN_TTL = (
    10 * 60
)  # a login attempt (state + PKCE verifier) must complete within 10 minutes

_lock = threading.Lock()
_discovery_cache: dict[str, dict[str, Any]] = {}

SESSIONS: dict[str, "SessionData"] = {}
PENDING_LOGINS: dict[str, dict[str, Any]] = {}


@dataclass
class SessionData:
    sub: str
    email: str
    name: str
    created_at: float = field(default_factory=time.time)
    expires_at: float = 0.0

    #: The provider's own tokens for this session, empty unless someone kept
    #: them. The hosted deployment logs its users in at the very issuer that
    #: also guards the backup endpoint, so the access token it already receives
    #: is the one that endpoint wants -- keeping it here means a hosted instance
    #: needs no second login, while the desktop build (which has no OIDC session
    #: at all) simply leaves the fields empty. Only the fields live here; who
    #: fills them is server.py's business.
    access_token: str = ""
    refresh_token: str = ""

    #: When `access_token` stops being accepted, or 0.0 if the provider did not
    #: say. Kept because a session outlives its access token by a wide margin --
    #: a session is good for SESSION_TTL, an access token for whatever the realm
    #: says, commonly five minutes. Without this the token here would silently
    #: rot while the session stayed perfectly valid, and anything using it would
    #: start failing for no visible reason.
    access_expires_at: float = 0.0

    def __post_init__(self) -> None:
        if not self.expires_at:
            self.expires_at = self.created_at + SESSION_TTL


def _http_json(
    url: str, data: bytes | None = None, headers: dict[str, str] | None = None
) -> dict[str, Any]:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, timeout=15, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"OIDC provider returned HTTP {exc.code}: {detail}") from exc


def discover(issuer: str | None = None) -> dict[str, Any]:
    issuer = issuer if issuer is not None else ISSUER
    with _lock:
        cached = _discovery_cache.get(issuer)
    if cached is not None:
        return cached
    document = _http_json(f"{issuer}/.well-known/openid-configuration")
    with _lock:
        _discovery_cache[issuer] = document
    return document


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def new_state() -> str:
    return secrets.token_urlsafe(24)


def _purge_expired_logins() -> None:
    now = time.time()
    for key in [
        k for k, entry in PENDING_LOGINS.items() if now - entry["created_at"] > PENDING_LOGIN_TTL
    ]:
        PENDING_LOGINS.pop(key, None)


def start_login(
    redirect_uri: str, *, issuer: str | None = None, client_id: str | None = None
) -> tuple[str, str]:
    """Build the Keycloak authorize URL and register the pending login server-side.

    The returned `state` must ALSO be round-tripped through a short-lived cookie by
    the caller (server.py) — requiring both the cookie and this server-side entry to
    match on callback is what prevents login-CSRF (see backend/auth.py module docs
    and the plan's security section).

    `issuer`/`client_id` default to this deployment's own configuration, so every
    existing caller keeps working unchanged. They exist because a process can
    face more than one issuer: the backup endpoint names its own (see
    backend/backup_login.py), and a second issuer must be a parameter rather
    than a second copy of this flow.
    """
    document = discover(issuer)
    client_id = client_id if client_id is not None else CLIENT_ID
    verifier, challenge = new_pkce_pair()
    state = new_state()
    with _lock:
        _purge_expired_logins()
        PENDING_LOGINS[state] = {
            "verifier": verifier,
            "redirect_uri": redirect_uri,
            "created_at": time.time(),
        }
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    authorize_url = f"{document['authorization_endpoint']}?{urllib.parse.urlencode(params)}"
    return authorize_url, state


def consume_pending_login(state: str) -> dict[str, Any] | None:
    """Pop and return the pending login for `state`, or None if unknown/expired.

    Single-use by construction (pop): a replayed callback with the same state fails.
    """
    with _lock:
        _purge_expired_logins()
        return PENDING_LOGINS.pop(state, None)


def exchange_code(
    code: str,
    code_verifier: str,
    redirect_uri: str,
    *,
    issuer: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> dict[str, Any]:
    """Trade an authorization code for tokens at `issuer`'s token endpoint.

    Same defaulting as start_login: with no keywords this is exactly the call it
    always was. A public client (no secret, PKCE only) passes client_secret="",
    and the field is then left out of the request entirely rather than sent
    empty -- RFC 6749 has a public client omit it, and an empty client_secret is
    a value some providers read as a failed authentication attempt rather than
    as an absent one. PKCE is what proves the caller here, not a secret.
    """
    document = discover(issuer)
    client_id = client_id if client_id is not None else CLIENT_ID
    client_secret = client_secret if client_secret is not None else CLIENT_SECRET
    fields = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": code_verifier,
    }
    if client_secret:
        fields["client_secret"] = client_secret
    body = urllib.parse.urlencode(fields).encode("ascii")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    return _http_json(document["token_endpoint"], data=body, headers=headers)


def refresh_tokens(
    refresh_token: str,
    *,
    issuer: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> dict[str, Any]:
    """Trade a refresh token for a fresh set at `issuer`'s token endpoint.

    The sibling of exchange_code, and public for the same reason: the login flow
    has two halves, and a caller facing a second issuer needs both of them.
    Without this, obtaining the first token is a supported operation while
    keeping it alive means reaching into this module's private helpers.
    """
    document = discover(issuer)
    client_id = client_id if client_id is not None else CLIENT_ID
    client_secret = client_secret if client_secret is not None else CLIENT_SECRET
    fields = {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id}
    if client_secret:  # omitted for a public client -- see exchange_code
        fields["client_secret"] = client_secret
    body = urllib.parse.urlencode(fields).encode("ascii")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    return _http_json(document["token_endpoint"], data=body, headers=headers)


def decode_id_token_claims(id_token: str) -> dict[str, Any]:
    """Decode the ID token payload without verifying its signature — see module docstring."""
    parts = id_token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed ID token.")
    payload = parts[1]
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))


def validate_claims(
    claims: dict[str, Any], issuer: str | None = None, client_id: str | None = None
) -> None:
    issuer = issuer if issuer is not None else ISSUER
    client_id = client_id if client_id is not None else CLIENT_ID
    if claims.get("iss") != issuer:
        raise ValueError("Unexpected token issuer.")
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if client_id not in audiences:
        raise ValueError("Unexpected token audience.")
    if float(claims.get("exp", 0)) <= time.time():
        raise ValueError("Token has expired.")


def _purge_expired_sessions() -> None:
    now = time.time()
    for key in [k for k, session in SESSIONS.items() if now > session.expires_at]:
        SESSIONS.pop(key, None)


def create_session(sub: str, email: str, name: str, *, ttl: float = SESSION_TTL) -> str:
    """Create a session cookie. `ttl` defaults to a normal 24h login; pass a much
    shorter value for narrowly-scoped sessions (e.g. the PDF-render subprocess's
    one-shot credential, which only needs to live for the render itself)."""
    session_id = secrets.token_urlsafe(32)
    with _lock:
        _purge_expired_sessions()
        SESSIONS[session_id] = SessionData(
            sub=sub, email=email, name=name, expires_at=time.time() + ttl
        )
    return session_id


def get_session(session_id: str | None) -> SessionData | None:
    if not session_id:
        return None
    with _lock:
        session = SESSIONS.get(session_id)
        if session is not None and time.time() > session.expires_at:
            SESSIONS.pop(session_id, None)
            session = None
    return session


def destroy_session(session_id: str | None) -> None:
    if not session_id:
        return
    with _lock:
        SESSIONS.pop(session_id, None)


def end_session_url(
    id_token_hint: str | None = None, post_logout_redirect_uri: str | None = None
) -> str | None:
    """Best-effort RP-initiated logout URL at Keycloak; None if unavailable."""
    try:
        document = discover()
    except Exception:
        return None
    endpoint = document.get("end_session_endpoint")
    if not endpoint:
        return None
    params = {}
    if id_token_hint:
        params["id_token_hint"] = id_token_hint
    if post_logout_redirect_uri:
        params["post_logout_redirect_uri"] = post_logout_redirect_uri
    return f"{endpoint}?{urllib.parse.urlencode(params)}" if params else endpoint
