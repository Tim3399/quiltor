"""Stdlib adapters for process-scoped identity state and OIDC transport."""

from __future__ import annotations

import hmac
import json
import math
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from quiltor.modules.identity.auth import (
    PENDING_LOGIN_TTL,
    SESSION_TTL,
    IdentityConfiguration,
    InvalidTokenSignature,
    SessionData,
    decode_id_token_header,
    extract_roles,
    pkce_challenge,
    verify_id_token,
)

MAX_OIDC_RESPONSE_BYTES = 1024 * 1024
MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
MAX_DISCOVERY_ISSUERS = 16
MAX_JWKS_KEYS = 32
MAX_PENDING_LOGINS = 256
#: Open logins one client address may hold. A flood from one address is refused
#: instead of displacing the logins other browsers have in progress (S268-2); a
#: real login is over in seconds, so 64 in flight behind one address is generous.
MAX_PENDING_LOGINS_PER_CLIENT = 64
MAX_SESSIONS = 4096
#: Sessions one account may hold at once. Every login makes a new session (no
#: fixation), so without a bound one account could fill MAX_SESSIONS and lock
#: everybody else out (S268-3). Ten covers a person's browsers and devices plus
#: PDF render sessions; beyond that the account's own oldest session makes room.
MAX_SESSIONS_PER_SUB = 10
#: How long roles read from the provider are trusted without a new confirmation
#: (a refresh that returned a verified ID token, or the login itself). Twice the
#: realm's 300 s access-token lifetime, so one missed refresh does not cost the
#: roles, and short enough that a withdrawn role or a blocked account stops
#: counting soon after the provider can no longer be asked (S268-4, S268-5).
ROLE_FRESH_SECONDS = 600
DISCOVERY_TTL_SECONDS = 60 * 60
JWKS_TTL_SECONDS = 15 * 60
JWKS_MIN_REFRESH_SECONDS = 30
#: After a refresh that failed without ending the session, no new attempt for this long.
REFRESH_BACKOFF_SECONDS = 60
#: Pauses between attempts to fetch the discovery document: four attempts in all.
#: A restarting Keycloak answers 503 for ~18 s; this does not try to bridge that,
#: because a login request must not hang. It rides out a blip of a few seconds and
#: otherwise hands the author a page that says "try again" (T-253).
DISCOVERY_RETRY_DELAYS = (0.5, 1.0, 2.0)
#: No further attempt starts once this much time has passed since the first one, so
#: provider timeouts (10 s each) cannot stack into a minute-long login request.
DISCOVERY_RETRY_BUDGET_SECONDS = 8.0


class ProviderUnavailable(ValueError):
    """The provider could not be reached or answered 5xx -- worth asking again.

    Everything else that goes wrong with a provider response (bad content type,
    bad JSON, a 4xx) is not transient and stays a plain ValueError.
    """


class LoginCapacityReached(ProviderUnavailable):
    """This client address already holds as many open logins as it may.

    A ProviderUnavailable, so the login route answers it with the same "try again
    in a moment" page instead of a 500.
    """


class TokenEndpointRejected(ValueError):
    """The token endpoint refused the grant with HTTP 400 or 401.

    `error` is the OAuth error code from the response body (`invalid_grant`,
    `invalid_client`, ...), or "" when the body named none. Only `invalid_grant`
    means the login itself is over; everything else is the server's problem.
    """

    def __init__(self, error: str) -> None:
        super().__init__("OIDC provider rejected the token request.")
        self.error = error


def _rejection_code(error: urllib.error.HTTPError) -> str:
    """The OAuth error code of a refused token request, read with a size bound."""
    try:
        raw = error.read(MAX_TOKEN_RESPONSE_BYTES + 1)
        if len(raw) > MAX_TOKEN_RESPONSE_BYTES:
            return ""
        document = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        return ""
    code = document.get("error") if isinstance(document, dict) else None
    if not isinstance(code, str) or len(code) > 64:
        return ""
    return code


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class UrllibJsonTransport:
    """Certificate-verifying JSON transport with bounded, non-leaky errors."""

    def __init__(self) -> None:
        self._opener = urllib.request.build_opener(
            _NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
        )

    def request(
        self, url: str, data: bytes | None = None, headers: dict[str, str] | None = None
    ) -> dict[str, Any]:
        request = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with self._opener.open(request, timeout=10) as response:
                content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0]
                if content_type.lower() not in {
                    "application/json",
                    "application/jwk-set+json",
                }:
                    raise ValueError("OIDC provider returned an invalid content type.")
                maximum = MAX_TOKEN_RESPONSE_BYTES if data is not None else MAX_OIDC_RESPONSE_BYTES
                raw = response.read(maximum + 1)
                if len(raw) > maximum:
                    raise ValueError("OIDC provider response is too large.")
                document = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if data is not None and exc.code in (400, 401):
                raise TokenEndpointRejected(_rejection_code(exc)) from exc
            if exc.code >= 500:
                raise ProviderUnavailable(f"OIDC provider returned HTTP {exc.code}.") from exc
            raise ValueError(f"OIDC provider returned HTTP {exc.code}.") from exc
        except OSError as exc:
            raise ProviderUnavailable("OIDC provider is unreachable.") from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ValueError("OIDC provider returned an invalid response.") from exc
        if not isinstance(document, dict):
            raise ValueError("OIDC provider returned an invalid response.")
        return document


class StdlibIdentityGateway:
    """One injected identity runtime; no module-level sessions or login state."""

    def __init__(
        self,
        configuration: IdentityConfiguration,
        *,
        transport: UrllibJsonTransport | Any | None = None,
        clock: Callable[[], float] = time.time,
        token_factory: Callable[[int], str] = secrets.token_urlsafe,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.configuration = configuration
        self._sleep = sleep
        self._transport = transport or UrllibJsonTransport()
        self._clock = clock
        self._token_factory = token_factory
        self._lock = threading.RLock()
        self._discovery: dict[str, tuple[float, dict[str, Any]]] = {}
        self._jwks: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}
        self._jwks_refresh_locks: dict[str, threading.Lock] = {}
        self._jwks_last_refresh: dict[str, float] = {}
        self._sessions: dict[str, SessionData] = {}
        self._owner_sessions: dict[str, str] = {}
        self._pending: dict[str, dict[str, Any]] = {}
        self._refresh_locks: dict[str, threading.Lock] = {}
        #: session id -> gateway-clock time its roles were last confirmed by the provider
        self._roles_confirmed: dict[str, float] = {}
        if self.issuer:
            self._validate_issuer(self.issuer)

    @property
    def issuer(self) -> str:
        return self.configuration.issuer

    @property
    def client_id(self) -> str:
        return self.configuration.client_id

    @property
    def enabled(self) -> bool:
        return self.configuration.enabled

    @property
    def session_ttl(self) -> int:
        return SESSION_TTL

    @property
    def session_count(self) -> int:
        with self._lock:
            self._purge_sessions()
            return len(self._sessions)

    def clear(self) -> None:
        """Clear this runtime's volatile state (orderly shutdown and tests)."""

        with self._lock:
            self._discovery.clear()
            self._jwks.clear()
            self._jwks_refresh_locks.clear()
            self._jwks_last_refresh.clear()
            self._sessions.clear()
            self._owner_sessions.clear()
            self._pending.clear()
            self._refresh_locks.clear()
            self._roles_confirmed.clear()

    @staticmethod
    def _origin(url: str) -> str:
        parts = urllib.parse.urlsplit(url)
        port = parts.port
        default = (parts.scheme == "https" and port in (None, 443)) or (
            parts.scheme == "http" and port in (None, 80)
        )
        authority = parts.hostname or ""
        if ":" in authority:
            authority = f"[{authority}]"
        if not default and port is not None:
            authority = f"{authority}:{port}"
        return f"{parts.scheme.lower()}://{authority.lower()}"

    def _validate_secure_url(self, value: str, *, label: str) -> str:
        if not isinstance(value, str) or not value or len(value) > 2048:
            raise ValueError(f"OIDC {label} is invalid.")
        try:
            parts = urllib.parse.urlsplit(value)
            _ = parts.port
        except ValueError as exc:
            raise ValueError(f"OIDC {label} is invalid.") from exc
        if (
            not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or parts.fragment
        ):
            raise ValueError(f"OIDC {label} is invalid.")
        if parts.scheme == "https":
            return value.rstrip("/")
        loopback = (parts.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
        if parts.scheme == "http" and loopback and self.configuration.allow_insecure_loopback:
            return value.rstrip("/")
        raise ValueError(f"OIDC {label} must use HTTPS.")

    def _validate_issuer(self, issuer: str) -> str:
        selected = self._validate_secure_url(issuer, label="issuer")
        parts = urllib.parse.urlsplit(selected)
        if parts.query or parts.fragment:
            raise ValueError("OIDC issuer is invalid.")
        return selected

    def _trusted_endpoint(self, endpoint: Any, issuer: str, label: str) -> str:
        value = self._validate_secure_url(str(endpoint or ""), label=label)
        trusted = {self._origin(issuer)}
        for origin in self.configuration.trusted_endpoint_origins:
            validated = self._validate_secure_url(origin, label="trusted endpoint origin")
            trusted.add(self._origin(validated))
        if self._origin(value) not in trusted:
            raise ValueError(f"OIDC {label} is not on a trusted origin.")
        return value

    def _validate_discovery(self, document: dict[str, Any], issuer: str) -> dict[str, Any]:
        if document.get("issuer") != issuer:
            raise ValueError("OIDC discovery issuer does not match configuration.")
        validated = dict(document)
        for name in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
            validated[name] = self._trusted_endpoint(document.get(name), issuer, name)
        if document.get("end_session_endpoint"):
            validated["end_session_endpoint"] = self._trusted_endpoint(
                document["end_session_endpoint"], issuer, "end_session_endpoint"
            )
        return validated

    def discover(self, issuer: str | None = None, *, retry: bool = True) -> dict[str, Any]:
        selected = (issuer if issuer is not None else self.issuer).rstrip("/")
        if not selected:
            raise ValueError("OIDC issuer is not configured.")
        selected = self._validate_issuer(selected)
        if self.issuer and selected != self.issuer:
            raise ValueError("OIDC issuer override does not match configuration.")
        now = self._clock()
        with self._lock:
            cached = self._discovery.get(selected)
        if cached is not None and cached[0] > now:
            return dict(cached[1])
        # Only a success is stored below: a failure raises out of here, so the next
        # login asks the provider again instead of replaying the outage.
        document = self._validate_discovery(self._fetch_discovery(selected, retry), selected)
        with self._lock:
            if selected not in self._discovery and len(self._discovery) >= MAX_DISCOVERY_ISSUERS:
                oldest = min(self._discovery, key=lambda item: self._discovery[item][0])
                self._discovery.pop(oldest, None)
                self._jwks.pop(oldest, None)
                self._jwks_refresh_locks.pop(oldest, None)
                self._jwks_last_refresh.pop(oldest, None)
            self._discovery[selected] = (now + DISCOVERY_TTL_SECONDS, document)
        return dict(document)

    def _fetch_discovery(self, issuer: str, retry: bool = True) -> dict[str, Any]:
        """Fetch the discovery document, asking again while the provider is briefly away."""
        url = f"{issuer}/.well-known/openid-configuration"
        started = time.monotonic()
        for delay in (*(DISCOVERY_RETRY_DELAYS if retry else ()), None):
            try:
                return self._transport.request(url)
            except ProviderUnavailable:
                if (
                    delay is None
                    or time.monotonic() - started + delay > DISCOVERY_RETRY_BUDGET_SECONDS
                ):
                    raise
                self._sleep(delay)
        raise AssertionError("unreachable")  # pragma: no cover

    def new_pkce_pair(self) -> tuple[str, str]:
        verifier = self._token_factory(64)
        return verifier, pkce_challenge(verifier)

    def new_state(self) -> str:
        return self._token_factory(24)

    def _purge_pending(self) -> None:
        now = self._clock()
        stale = [
            key
            for key, entry in self._pending.items()
            if now - float(entry["created_at"]) > PENDING_LOGIN_TTL
        ]
        for key in stale:
            self._pending.pop(key, None)

    def start_login(
        self,
        redirect_uri: str,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
        ui_locales: str | None = None,
        client: str = "",
    ) -> tuple[str, str]:
        document = self.discover(issuer)
        selected_client = client_id if client_id is not None else self.client_id
        verifier, challenge = self.new_pkce_pair()
        state = self.new_state()
        nonce = self._token_factory(24)
        with self._lock:
            self._purge_pending()
            # Refuse rather than evict: the flooder is turned away and the logins
            # already in progress stay (S268-2).
            # No known client address (empty): only the global cap below applies.
            if (
                client
                and sum(1 for entry in self._pending.values() if entry.get("client") == client)
                >= MAX_PENDING_LOGINS_PER_CLIENT
            ):
                raise LoginCapacityReached("Too many open logins from this client.")
            if len(self._pending) >= MAX_PENDING_LOGINS:
                oldest = min(self._pending, key=lambda key: self._pending[key]["created_at"])
                self._pending.pop(oldest, None)
            self._pending[state] = {
                "client": client,
                "verifier": verifier,
                "redirect_uri": redirect_uri,
                "nonce": nonce,
                "created_at": self._clock(),
            }
        params = {
            "response_type": "code",
            "client_id": selected_client,
            "redirect_uri": redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        if ui_locales:
            params["ui_locales"] = ui_locales
        return f"{document['authorization_endpoint']}?{urllib.parse.urlencode(params)}", state

    def consume_pending_login(self, state: str) -> dict[str, Any] | None:
        with self._lock:
            self._purge_pending()
            matched = next((key for key in self._pending if hmac.compare_digest(key, state)), None)
            return self._pending.pop(matched, None) if matched is not None else None

    def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> dict[str, Any]:
        document = self.discover(issuer)
        selected_client = client_id if client_id is not None else self.client_id
        selected_secret = (
            client_secret if client_secret is not None else self.configuration.client_secret
        )
        fields = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": selected_client,
            "code_verifier": code_verifier,
        }
        if selected_secret:
            fields["client_secret"] = selected_secret
        return self._transport.request(
            document["token_endpoint"],
            data=urllib.parse.urlencode(fields).encode("ascii"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def refresh_tokens(
        self,
        refresh_token: str,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> dict[str, Any]:
        document = self.discover(issuer)
        selected_client = client_id if client_id is not None else self.client_id
        selected_secret = (
            client_secret if client_secret is not None else self.configuration.client_secret
        )
        fields = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": selected_client,
        }
        if selected_secret:
            fields["client_secret"] = selected_secret
        return self._transport.request(
            document["token_endpoint"],
            data=urllib.parse.urlencode(fields).encode("ascii"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def _load_jwks(self, issuer: str, *, force_refresh: bool = False) -> dict[str, dict[str, Any]]:
        now = self._clock()
        with self._lock:
            cached = self._jwks.get(issuer)
            refresh_lock = self._jwks_refresh_locks.setdefault(issuer, threading.Lock())
        if not force_refresh and cached is not None and cached[0] > now:
            return dict(cached[1])
        with refresh_lock:
            now = self._clock()
            with self._lock:
                cached = self._jwks.get(issuer)
                last_refresh = self._jwks_last_refresh.get(issuer, float("-inf"))
            if not force_refresh and cached is not None and cached[0] > now:
                return dict(cached[1])
            if (
                force_refresh
                and cached is not None
                and now - last_refresh < JWKS_MIN_REFRESH_SECONDS
            ):
                return dict(cached[1])
            document = self.discover(issuer)
            payload = self._transport.request(document["jwks_uri"])
            keys = payload.get("keys")
            if not isinstance(keys, list) or not 0 < len(keys) <= MAX_JWKS_KEYS:
                raise ValueError("OIDC JWKS contains an invalid key set.")
            indexed: dict[str, dict[str, Any]] = {}
            for item in keys:
                if not isinstance(item, dict):
                    raise ValueError("OIDC JWKS contains an invalid key.")
                kid = item.get("kid")
                if not isinstance(kid, str) or not kid or len(kid) > 255 or kid in indexed:
                    raise ValueError("OIDC JWKS contains an invalid key identifier.")
                indexed[kid] = dict(item)
            with self._lock:
                self._jwks[issuer] = (now + JWKS_TTL_SECONDS, indexed)
                self._jwks_last_refresh[issuer] = now
            return dict(indexed)

    def verify_id_token(
        self,
        id_token: str,
        expected_nonce: str | None,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
    ) -> dict[str, Any]:
        selected_issuer = self._validate_issuer(issuer if issuer is not None else self.issuer)
        selected_client = client_id if client_id is not None else self.client_id
        header = decode_id_token_header(id_token)
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise ValueError("Invalid ID token key identifier.")
        keys = self._load_jwks(selected_issuer)
        key = keys.get(kid)
        if key is None:
            # A normal rotation publishes a new kid before the discovery/JWKS
            # TTL expires. Refetch exactly once; an unknown kid still fails.
            keys = self._load_jwks(selected_issuer, force_refresh=True)
            key = keys.get(kid)
        if key is None:
            raise ValueError("No trusted verification key matches the ID token.")
        try:
            return verify_id_token(
                id_token,
                key,
                issuer=selected_issuer,
                client_id=selected_client,
                now=self._clock(),
                expected_nonce=expected_nonce,
                allowed_algorithms=self.configuration.allowed_id_token_algorithms,
            )
        except InvalidTokenSignature as error:
            rotated = self._load_jwks(selected_issuer, force_refresh=True).get(kid)
            if rotated is None:
                raise ValueError("No trusted verification key matches the ID token.") from error
            return verify_id_token(
                id_token,
                rotated,
                issuer=selected_issuer,
                client_id=selected_client,
                now=self._clock(),
                expected_nonce=expected_nonce,
                allowed_algorithms=self.configuration.allowed_id_token_algorithms,
            )

    def validate_claims(
        self,
        claims: dict[str, Any],
        issuer: str | None = None,
        client_id: str | None = None,
    ) -> None:
        # Kept for non-token callers that already possess trusted claims. ID
        # tokens must always go through verify_id_token(), which verifies the
        # issuer-bound signature before this claim layer.
        from quiltor.modules.identity.auth import validate_claims

        validate_claims(
            claims,
            issuer=issuer if issuer is not None else self.issuer,
            client_id=client_id if client_id is not None else self.client_id,
            now=self._clock(),
        )

    def _purge_sessions(self) -> None:
        now = self._clock()
        stale = [key for key, session in self._sessions.items() if now > session.expires_at]
        for key in stale:
            self._sessions.pop(key, None)
            self._refresh_locks.pop(key, None)
            self._roles_confirmed.pop(key, None)
        for owner, key in list(self._owner_sessions.items()):
            if key not in self._sessions:
                self._owner_sessions.pop(owner, None)

    def create_session(self, sub: str, email: str, name: str, *, ttl: float | None = None) -> str:
        if not isinstance(sub, str) or not sub or len(sub) > 255:
            raise ValueError("Invalid session subject.")
        session_id = self._token_factory(32)
        now = self._clock()
        lifetime = SESSION_TTL if ttl is None else ttl
        if lifetime <= 0 or lifetime > SESSION_TTL:
            raise ValueError("Invalid session lifetime.")
        with self._lock:
            self._purge_sessions()
            same_account = [key for key, held in self._sessions.items() if held.sub == sub]
            if len(same_account) >= MAX_SESSIONS_PER_SUB:
                # The account's own oldest session makes room, never somebody else's.
                oldest = min(same_account, key=lambda key: self._sessions[key].created_at)
                self._drop_session(oldest)
            if len(self._sessions) >= MAX_SESSIONS:
                raise RuntimeError("Identity session capacity has been reached.")
            self._sessions[session_id] = SessionData(
                sub=sub,
                email=email,
                name=name,
                created_at=now,
                expires_at=now + lifetime,
                session_id=session_id,
            )
        return session_id

    def _drop_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._refresh_locks.pop(session_id, None)
        self._roles_confirmed.pop(session_id, None)
        for owner, key in list(self._owner_sessions.items()):
            if key == session_id:
                self._owner_sessions.pop(owner, None)

    def _view(self, session: SessionData) -> SessionData:
        """The session as callers see it: roles nobody confirmed lately count as empty.

        The stored session keeps its roles, so the next confirmation restores them.
        """
        if not session.roles:
            return session
        confirmed = self._roles_confirmed.get(session.session_id)
        if confirmed is not None and self._clock() - confirmed <= ROLE_FRESH_SECONDS:
            return session
        return replace(session, roles=())

    def premium_confirmed(self, sub: str, role: str) -> bool:
        """Whether a session of `sub` holds `role`, confirmed recently enough.

        Reads only; it never asks the provider. No session, a logged-out or expired
        session and a restart all answer False.
        """
        with self._lock:
            self._purge_sessions()
            return any(
                role in self._view(held).roles
                for held in self._sessions.values()
                if held.sub == sub
            )

    @staticmethod
    def _token_text(tokens: dict[str, Any], name: str) -> str:
        value = tokens.get(name, "")
        if not isinstance(value, str) or len(value) > 64 * 1024:
            raise ValueError("OIDC provider returned an invalid token response.")
        return value

    def store_session_tokens(
        self,
        session_id: str,
        tokens: dict[str, Any],
        *,
        verified_id_token: str | None = None,
        verified_claims: dict[str, Any] | None = None,
    ) -> SessionData | None:
        try:
            expires_in = float(tokens.get("expires_in", 0) or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError("OIDC provider returned an invalid token lifetime.") from exc
        if (
            isinstance(tokens.get("expires_in", 0), bool)
            or not math.isfinite(expires_in)
            or expires_in < 0
            or expires_in > SESSION_TTL
        ):
            raise ValueError("OIDC provider returned an invalid token lifetime.")
        with self._lock:
            self._purge_sessions()
            current = self._sessions.get(session_id)
            if current is None:
                return None
            updated = replace(
                current,
                access_token=self._token_text(tokens, "access_token"),
                refresh_token=self._token_text(tokens, "refresh_token") or current.refresh_token,
                access_expires_at=(self._clock() + expires_in if "expires_in" in tokens else 0.0),
                id_token=(verified_id_token or current.id_token),
                # Roles only ever come from claims the caller has verified;
                # without them the session keeps the roles it already has.
                roles=(
                    extract_roles(verified_claims) if verified_claims is not None else current.roles
                ),
                refresh_retry_at=0.0,
            )
            self._sessions[session_id] = updated
            if verified_claims is not None:
                self._roles_confirmed[session_id] = self._clock()
            return self._view(updated)

    def _refresh_due(self, session: SessionData, leeway: float) -> bool:
        """Whether the access token has run out and no backoff is pending.

        Decided by the expiry alone, never by whether an access token is present:
        a failed refresh keeps its tokens and only sets `refresh_retry_at`.
        """
        now = self._clock()
        return (
            bool(session.refresh_token)
            and bool(session.access_expires_at)
            and now >= session.access_expires_at - leeway
            and now >= session.refresh_retry_at
        )

    def refresh_session(self, session_id: str, *, leeway: float = 30) -> SessionData | None:
        """Follow the provider: refresh an expired access token, re-read the roles.

        Returns None when the provider says the login is over (`invalid_grant`);
        the session is destroyed then. Any other failure keeps the session with
        its tokens and roles and waits REFRESH_BACKOFF_SECONDS before trying
        again. A refresh token is single-use, so concurrent callers share one
        token request: whoever gets the lock second finds the work done.
        """
        current = self.get_session(session_id)
        if current is None or not self._refresh_due(current, leeway):
            return current
        with self._lock:
            refresh_lock = self._refresh_locks.setdefault(session_id, threading.Lock())
        with refresh_lock:
            current = self.get_session(session_id)
            if current is None or not self._refresh_due(current, leeway):
                return current
            try:
                tokens = self.refresh_tokens(current.refresh_token)
                id_token = tokens.get("id_token")
                claims = None
                if id_token is not None:
                    if not isinstance(id_token, str) or not id_token:
                        raise ValueError("OIDC provider returned an invalid ID token.")
                    claims = self.verify_id_token(id_token, None)
                    if claims.get("sub") != current.sub:
                        # Another account's token for this session: the login is not ours.
                        self.destroy_session(session_id)
                        return None
                return self.store_session_tokens(
                    session_id,
                    tokens,
                    verified_id_token=id_token if claims is not None else None,
                    verified_claims=claims,
                )
            except TokenEndpointRejected as rejected:
                if rejected.error == "invalid_grant":
                    self.destroy_session(session_id)
                    return None
                return self._back_off(session_id)
            except Exception:  # noqa: BLE001 - network, 5xx, invalid response: keep the session
                return self._back_off(session_id)

    def _back_off(self, session_id: str) -> SessionData | None:
        with self._lock:
            latest = self._sessions.get(session_id)
            if latest is None:
                return None
            latest = replace(latest, refresh_retry_at=self._clock() + REFRESH_BACKOFF_SECONDS)
            self._sessions[session_id] = latest
            return self._view(latest)

    def session_access_token(self, session_id: str, *, leeway: float = 30) -> str:
        """A usable access token for backups, refreshed if needed; "" if there is none.

        During a backoff the expired token is not handed out.
        """
        current = self.refresh_session(session_id, leeway=leeway)
        if current is None or not current.access_token:
            return ""
        if current.access_expires_at and self._clock() >= current.access_expires_at - leeway:
            return ""
        return current.access_token

    def get_session(self, session_id: str | None) -> SessionData | None:
        if not session_id:
            return None
        with self._lock:
            self._purge_sessions()
            held = self._sessions.get(session_id)
            return self._view(held) if held is not None else None

    def destroy_session(self, session_id: str | None) -> None:
        if not session_id:
            return
        with self._lock:
            self._drop_session(session_id)

    def owner_session(self, sub: str) -> tuple[str, SessionData]:
        with self._lock:
            self._purge_sessions()
            session_id = self._owner_sessions.get(sub, "")
            session = self._sessions.get(session_id)
            if session is None:
                session_id = self.create_session(sub, "", "")
                session = self._sessions[session_id]
                self._owner_sessions[sub] = session_id
            return session_id, session

    def end_session_url(
        self,
        id_token_hint: str | None = None,
        post_logout_redirect_uri: str | None = None,
    ) -> str | None:
        try:
            document = self.discover(retry=False)
        except Exception:  # noqa: BLE001 - an unreachable discovery document means no end-session endpoint
            return None
        endpoint = document.get("end_session_endpoint")
        if not endpoint:
            return None
        params: dict[str, str] = {}
        if id_token_hint:
            if len(id_token_hint) > 64 * 1024:
                return None
            params["id_token_hint"] = id_token_hint
        if post_logout_redirect_uri:
            try:
                redirect = self._validate_secure_url(
                    post_logout_redirect_uri, label="post-logout redirect URI"
                )
            except ValueError:
                return None
            params["post_logout_redirect_uri"] = redirect
        return f"{endpoint}?{urllib.parse.urlencode(params)}" if params else str(endpoint)


__all__ = ["StdlibIdentityGateway", "TokenEndpointRejected", "UrllibJsonTransport"]
