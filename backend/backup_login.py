"""Signing in to a backup endpoint -- Authorization Code + PKCE over loopback.

The backup endpoint wants an OIDC access token carrying the `quiltor.backup`
scope, and it says so itself: `GET {base}/.well-known/oauth-protected-resource`
names the issuer it trusts (RFC 9728, see deploy/backup-server/server.py). So
this module never asks anyone to configure an issuer -- it reads the backup URL
the user already entered, asks the endpoint who guards it, and takes the login
from there. One setting, not two that can disagree.

The flow is the one RFC 8252 prescribes for an application that is not a website:
the browser goes to the issuer, the issuer redirects to a loopback URL this
machine is listening on, and the code that arrives there is exchanged for tokens
server-side. PKCE binds the exchange to the request that started it, and `state`
is checked against a server-side record that is single-use -- the same double
check the hosted login in backend/auth.py makes, for the same reason.

This module lives in `backend/`, not `backend/core/`: it imports backend.auth,
which core is forbidden to know about (enforced by tests/backend/test_core.py).
That boundary is the reason the file sits next to identity.py rather than beside
the protocol code in backend/core/backup/remote.py, which stays ignorant of how
a token is obtained and only knows that `TOKEN_SOURCE` produces one.

Why this token is written to disk, when backend/identity.py makes a point of
never writing its master token there:

    The local master token may be ephemeral, because it protects nothing that is
    not sitting next to it on the same disk anyway, and because it does not have
    to survive a restart. This token is a credential towards a foreign service:
    if it does not survive a restart, every start demands a browser login, and
    "backs up automatically" would be a lie. It has to be persisted -- and
    because it has to be, it is stored as narrowly as possible rather than as
    conveniently as possible.

Narrow means: one file under storage.DATA, created with mode 0600 and never
group- or world-readable, holding only the tokens themselves and the account
they belong to. Note that this token reaches further than the local data does:
it also unlocks the snapshots *other devices* of the same account uploaded, so
it is worth more than the world files lying beside it. A real keychain (Keychain
on macOS, DPAPI/Credential Manager on Windows, Secret Service on Linux) is the
better home, and backend/system/{macos,windows,linux}.py is where that would be
retrofitted behind this same interface -- `_load`/`_save` are the only two
functions that would have to change.

Standard library only.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any

from backend import auth
from backend.core import storage
from backend.core.backup import remote

#: The public client this machine authenticates as. Public in the OAuth sense:
#: a desktop installation cannot keep a secret, so there is none and PKCE does
#: the work a client secret would otherwise pretend to do.
CLIENT_ID = os.environ.get("QUILTOR_BACKUP_CLIENT_ID", "quiltor-desktop")

#: Assumed when the endpoint's metadata names no scope of its own -- the value
#: deploy/backup-server/server.py defaults to.
DEFAULT_SCOPE = "quiltor.backup"

#: A login attempt must complete within this window, like auth.PENDING_LOGIN_TTL:
#: it is the time between opening a browser and finishing a login form.
PENDING_TTL = auth.PENDING_LOGIN_TTL

#: Refresh this many seconds before the access token actually expires, so an
#: upload that starts just under the wire does not fail halfway through.
REFRESH_LEEWAY = 30

HTTP_TIMEOUT = 15

#: How long an answer about *the endpoint* (which issuer, is it up) is reused.
#: The dialog asks on every open, and the two calls behind that answer are the
#: only slow thing in it. Seconds rather than minutes: this cache exists to
#: survive a burst of polling, not to hide that a server came back up.
PROBE_TTL = 5.0

#: How long a status() call waits for the very first probe of an endpoint before
#: answering "not reachable". The two requests behind it are bounded only by
#: remote.TIMEOUT_METADATA and auth's own 15s -- up to half a minute, which is
#: not a wait a dialog may impose on anyone. So the probe runs on its own thread
#: and this is how long status() gives it; whatever it eventually learns lands in
#: the cache and is what the next call answers with.
PROBE_PATIENCE = 3.0

_lock = threading.Lock()

#: state -> the login attempt it belongs to. Server-side and single-use, exactly
#: like auth.PENDING_LOGINS: the value that comes back from the browser is only
#: ever *matched* against something that was recorded here, never trusted.
PENDING: dict[str, dict[str, Any]] = {}

#: Parsed contents of the store file, or None while it has not been read yet.
_cache: dict[str, Any] | None = None

#: endpoint -> (when it was learned, (issuer, scope, reachable)). Only the part
#: of status() that costs network calls; the signed-in half is read from the
#: store every time, so signing in or out shows immediately.
_probes: dict[str, tuple[float, tuple[str, str, bool]]] = {}

#: endpoint -> the thread currently probing it, so a dialog polling every second
#: does not start a queue of identical lookups against a server that is down.
_probing: dict[str, threading.Thread] = {}


# --------------------------------------------------------------- the endpoint


def issuer_for(base_url: str) -> tuple[str, str]:
    """The issuer guarding `base_url`, and the scope it expects.

    This is the whole reason nobody configures an issuer twice: the endpoint is
    the authority on which login it accepts, so asking it is both less setup and
    less that can drift apart when a deployment moves to another realm.
    """
    document = remote.resource_metadata(base_url)
    servers = document.get("authorization_servers") or []
    issuer = str(servers[0]).rstrip("/") if servers else ""
    if not issuer:
        raise RuntimeError(
            f"The backup endpoint at {base_url} does not publish an issuer to log in with. "
            "Endpoints that hand out tokens by hand are used with QUILTOR_BACKUP_TOKEN instead."
        )
    scopes = document.get("scopes_supported") or []
    return issuer, str(scopes[0]) if scopes else DEFAULT_SCOPE


def _run_probe(base: str) -> None:
    """Ask the endpoint who guards it and whether that issuer answers, and file
    the result. Never raises -- it runs on a thread nobody joins for long, and
    "unreachable" is a perfectly good thing to have learned."""
    try:
        issuer, scope = issuer_for(base)
        auth.discover(issuer)
        result = (issuer, scope, True)
    except Exception:
        result = ("", "", False)
    with _lock:
        _probes[base] = (time.time(), result)


def _probe(base: str) -> tuple[str, str, bool | None]:
    """The cached (issuer, scope, reachable) for `base`, refreshed when stale.

    Exactly one call ever waits: the one that finds nothing recorded at all and
    starts the lookup. Every other call answers from what is known -- a stale
    entry, or "still looking" while the first lookup is out -- and lets the
    running probe finish in the background. That is what keeps a dead endpoint
    from costing PROBE_PATIENCE on every single open of the dialog, while a live
    one is still answered accurately the very first time it is asked about.

    `reachable` is deliberately three-valued: True, False, or None for "not
    known yet". A slow-but-live issuer that has not answered within
    PROBE_PATIENCE is not the same thing as one that refused, and reporting
    False for it would tell the dialog to hide the sign-in button over a
    question nobody has answered. None says so, and the next call -- by then
    holding the finished probe -- says something definite.
    """
    now = time.time()
    with _lock:
        stamped = _probes.get(base)
        if stamped is not None and now - stamped[0] < PROBE_TTL:
            return stamped[1]
        running = _probing.get(base)
        ours = running is None or not running.is_alive()
        if ours:
            running = threading.Thread(target=_run_probe, args=(base,), daemon=True)
            _probing[base] = running
            running.start()
    if stamped is None and ours:
        running.join(PROBE_PATIENCE)
        with _lock:
            stamped = _probes.get(base)
    return stamped[1] if stamped is not None else ("", "", None)


# ------------------------------------------------------------------ the login


def _purge_expired_pending() -> None:
    now = time.time()
    for key in [k for k, entry in PENDING.items() if now - entry["created_at"] > PENDING_TTL]:
        PENDING.pop(key, None)


def begin(base_url: str, redirect_uri: str) -> str:
    """The URL to open in a browser to sign in to `base_url`.

    `redirect_uri` is a loopback URL the caller is listening on (RFC 8252).
    Everything the callback will have to be checked against -- the PKCE verifier,
    the redirect, which endpoint this login is even for -- stays here and never
    travels through the browser.
    """
    base = _key(base_url)
    issuer, scope = issuer_for(base)
    document = auth.discover(issuer)
    verifier, challenge = auth.new_pkce_pair()
    state = auth.new_state()
    with _lock:
        _purge_expired_pending()
        PENDING[state] = {
            "verifier": verifier,
            "redirect_uri": redirect_uri,
            "base_url": base,
            "issuer": issuer,
            "scope": scope,
            "created_at": time.time(),
        }
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        # offline_access is what makes the refresh token appear. Without one,
        # "backs up automatically" would last exactly as long as the first access
        # token and then demand a browser again.
        "scope": f"openid {scope} offline_access",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{document['authorization_endpoint']}?{urllib.parse.urlencode(params)}"


def consume_pending(state: str) -> dict[str, Any] | None:
    """Pop the login attempt for `state`, or None if unknown or expired.

    Single-use by construction (pop), like auth.consume_pending_login: a callback
    replayed with the same state finds nothing the second time.
    """
    with _lock:
        _purge_expired_pending()
        return PENDING.pop(state, None)


def complete(code: str, state: str, redirect_uri: str) -> dict[str, Any]:
    """Finish the login the callback carries, and remember the result.

    Two checks before the code is worth anything: the `state` has to name a login
    this process started, and the redirect it comes back on has to be the one
    that login asked for. A code delivered under a state we never issued is
    somebody else's login being pushed onto this machine, which is precisely what
    the pending record exists to refuse.
    """
    pending = consume_pending(state)
    if pending is None:
        raise ValueError("Unknown or expired login attempt.")
    if redirect_uri != pending["redirect_uri"]:
        raise ValueError("The login came back on a different redirect than it started with.")

    tokens = auth.exchange_code(
        code,
        pending["verifier"],
        redirect_uri,
        issuer=pending["issuer"],
        client_id=CLIENT_ID,
        client_secret="",
    )
    record = {
        "issuer": pending["issuer"],
        "scope": pending["scope"],
        "access_token": str(tokens.get("access_token", "")),
        "refresh_token": str(tokens.get("refresh_token", "")),
        "expires_at": time.time() + float(tokens.get("expires_in", 0) or 0),
    }
    record.update(_account_of(tokens))
    if not record["access_token"]:
        raise ValueError("The issuer returned no access token.")
    _store(pending["base_url"], record)
    return status(pending["base_url"])


def _account_of(tokens: dict[str, Any]) -> dict[str, str]:
    """Who logged in, read off the ID token.

    The signature is not verified, for the reason backend/auth.py's module
    docstring gives: this response came back over a direct, certificate-verified
    call to the issuer's token endpoint and never passed through the browser, so
    there is no untrusted hop for a forged token to enter through. The claims are
    only used to show a name in the UI -- the endpoint decides for itself, by
    introspection, whose account the token opens.
    """
    try:
        claims = auth.decode_id_token_claims(str(tokens.get("id_token", "")))
    except (ValueError, KeyError):
        return {"account": "", "email": "", "name": ""}
    return {
        "account": str(claims.get("sub", "")),
        "email": str(claims.get("email", "")),
        "name": str(claims.get("name", "")),
    }


def _refresh(record: dict[str, Any]) -> dict[str, Any] | None:
    """Trade the refresh token for a fresh access token, or None if that failed.

    A refresh token the issuer rejects is dead -- revoked, expired, or the realm
    moved on -- so the stored record goes with it. Leaving it in place would mean
    every later request repeating a call that cannot start working again.
    """
    if not record.get("refresh_token"):
        return None
    try:
        # auth.refresh_tokens rather than a second copy of the exchange: both
        # halves of this flow then report a provider error in one and the same
        # shape. client_secret="" marks a public client, which sends none.
        tokens = auth.refresh_tokens(
            record["refresh_token"], issuer=record["issuer"], client_id=CLIENT_ID, client_secret=""
        )
    except Exception:
        return None
    access = str(tokens.get("access_token", ""))
    if not access:
        return None
    updated = dict(record)
    updated["access_token"] = access
    updated["refresh_token"] = str(tokens.get("refresh_token", "") or record["refresh_token"])
    updated["expires_at"] = time.time() + float(tokens.get("expires_in", 0) or 0)
    return updated


def access_token(base_url: str) -> str:
    """A currently valid access token for `base_url`, or "" if there is none.

    This is the function the host hangs into remote.TOKEN_SOURCE. It returns a
    string rather than raising because that is what the hook promises, and
    because "" is a truthful answer: the endpoint then replies 401 with a pointer
    to its own metadata, which is a far better error than an exception thrown
    from inside an upload loop.
    """
    base = _key(base_url)
    record = _read(base)
    if record is None:
        return ""
    if record.get("expires_at", 0) - REFRESH_LEEWAY > time.time():
        return str(record.get("access_token", ""))
    refreshed = _refresh(record)
    if refreshed is None:
        sign_out(base)
        return ""
    _store(base, refreshed)
    return str(refreshed["access_token"])


def status(base_url: str) -> dict[str, Any]:
    """What the UI needs to show for this endpoint. Never raises.

    `issuerReachable` separates "you are not signed in" from "nobody could sign
    in right now", which are different problems with different remedies and look
    identical from a failed upload. It is three-valued: null means the lookup has
    not come back yet, which is neither of those and must not be reported as the
    second -- a slow issuer would otherwise hide the sign-in button behind an
    answer nobody gave.
    """
    base = _key(base_url)
    record = _read(base)
    issuer = str(record.get("issuer", "")) if record else ""
    scope = str(record.get("scope", "")) if record else ""
    # The endpoint half comes from _probe, which is cached and time-bounded --
    # see PROBE_PATIENCE. On a failure the stored issuer/scope stay: they are
    # what this login was made against, and forgetting them because the network
    # blinked would tell the UI less than it already knew.
    probed_issuer, probed_scope, reachable = _probe(base)
    if reachable:
        issuer, scope = probed_issuer, probed_scope
    return {
        "endpoint": base,
        "signedIn": bool(record and record.get("access_token")),
        "account": str(record.get("account", "")) if record else "",
        "email": str(record.get("email", "")) if record else "",
        "name": str(record.get("name", "")) if record else "",
        "issuer": issuer,
        "scope": scope,
        "issuerReachable": reachable,
    }


def sign_out(base_url: str) -> None:
    """Forget the tokens for this endpoint, and the file with them if it was the
    last one. Local only -- the token stays valid at the issuer until it expires
    or is revoked there, and pretending otherwise would overstate what a client
    can do on its own."""
    base = _key(base_url)
    with _lock:
        data = _load()
        if data["endpoints"].pop(base, None) is None:
            return
        _save(data)


# ----------------------------------------------------------------- the store
#
# One small JSON file, read once and kept. The two functions below are the whole
# storage interface: a keychain-backed implementation would replace exactly them
# (see the module docstring).


def _key(base_url: str) -> str:
    """The endpoint identity a token is filed under. Same normalisation
    remote._request applies before calling TOKEN_SOURCE, so the lookup there
    finds what the login wrote."""
    return base_url.rstrip("/")


def path() -> Path:
    """Computed per call, not at import: storage.DATA is reassigned by the CLI's
    --data flag and by the tests, and a path captured at import time would point
    at whatever was configured first."""
    return storage.DATA / "backup-login.json"


def _load() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    try:
        parsed = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        parsed = {}
    endpoints = parsed.get("endpoints") if isinstance(parsed, dict) else None
    _cache = {"version": 1, "endpoints": endpoints if isinstance(endpoints, dict) else {}}
    return _cache


def _save(data: dict[str, Any]) -> None:
    global _cache
    _cache = data
    target = path()
    if not data["endpoints"]:
        target.unlink(missing_ok=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    # On POSIX, create with an explicit mode rather than Path.write_text: the file
    # must never exist, not even briefly, with the umask's default permissions.
    # Windows does not expose its ACL through POSIX mode bits; the file instead
    # inherits the owner-scoped ACL of Quiltor's directory in the user profile.
    handle = os.open(str(target), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        # The mode argument above only applies when the file is created, so a
        # file that already exists keeps whatever mode it had. Set it explicitly.
        if hasattr(os, "fchmod"):
            os.fchmod(handle, 0o600)
        os.write(handle, payload)
    finally:
        os.close(handle)


def _read(base: str) -> dict[str, Any] | None:
    with _lock:
        record = _load()["endpoints"].get(base)
    return dict(record) if isinstance(record, dict) else None


def _store(base: str, record: dict[str, Any]) -> None:
    with _lock:
        data = _load()
        data["endpoints"][base] = record
        _save(data)


def forget_cache() -> None:
    """Drop everything held in memory, so the next call reads the disk and the
    network again. For the CLI, which can be pointed at another data directory
    mid-process, and for tests that change what the endpoint would answer and
    need status() to notice within the same second."""
    global _cache
    _cache = None
    with _lock:
        _probes.clear()
        _probing.clear()


__all__ = [
    "CLIENT_ID",
    "DEFAULT_SCOPE",
    "PENDING",
    "access_token",
    "begin",
    "complete",
    "consume_pending",
    "forget_cache",
    "issuer_for",
    "path",
    "sign_out",
    "status",
]
