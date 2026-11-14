"""Who is asking -- the one place that turns an HTTP request into a session.

Quiltor runs in two shapes that differ in *who the users are*, not in what the
application does: the hosted deployment has accounts behind an OIDC provider,
the desktop/CLI build has exactly one person sitting at the machine. Both need a
`SessionData` for every request, because everything downstream (world ownership,
backups, the assistant) is written against one.

So this surface is a set of behaviour questions rather than a mode flag. Callers
ask "is there a login page?" (`login_url`) and "is there more than one user?"
(`multi_user`); they never ask "are we local?". That keeps each answer next to
the rule it follows from, and means the two implementations below stay the only
place where the difference lives.

Exactly one implementation is installed per process, and there is no third state
for "no identity at all": a request either resolves to a session or it does not,
and the caller decides what an unresolved request gets (401 or a redirect).

Identity is a product module rather than story-world domain code: it reads
cookies, headers, and query parameters. It never imports a host; everything it
needs from the running HTTP process is asked of the handler passed to it. The
domain and host boundary tests enforce both directions.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections.abc import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from quiltor.modules.identity import auth
from quiltor.modules.identity.ports import IdentityGateway, OwnerIdentityStore, RenderTokenStore

#: The session cookie's name. It lives here rather than in the web host because
#: identity owns both writing and reading it; the composition root imports it.
SESSION_COOKIE = "quiltor_session"

#: Attribute an implementation sets on the handler when the request carried a
#: secret in its query string and must be bounced to the same path without it.
#: The value is the cleaned-up path to redirect to. The dispatch reads it right
#: after resolving the session and answers 302 instead of serving the route --
#: an attribute rather than a return value because `resolve()` already returns
#: the session, and threading a second channel through every caller would make
#: the common case pay for the rare one.
REDIRECT_ATTR = "identity_redirect"

#: The provider role that unlocks the assistant under OIDC
#: (overridable with QUILTOR_PREMIUM_ROLE).
DEFAULT_PREMIUM_ROLE = "premium"

#: How long a one-time open code is accepted (F-269-11). It only has to cover the moment
#: between launching the browser or window and that page's first request.
OPEN_CODE_TTL = 120.0

#: At most this many unredeemed open codes are held; the oldest makes room.
MAX_OPEN_CODES = 8


class Identity:
    """How a request becomes a SessionData.

    Subclasses answer the two questions below and may extend `resolve()`; the
    base `resolve()` holds what is true of every deployment.
    """

    #: Where an unauthenticated browser is sent. None means this deployment has
    #: no interactive login at all -- /login and /auth/callback do not exist.
    login_url: str | None = None

    #: False means there is exactly one user, so nothing ever offers a choice of
    #: account, and "belongs to someone else" is not a state that can arise.
    multi_user: bool = False

    #: The role `is_premium` asks for. Only OidcIdentity reads it.
    premium_role: str = DEFAULT_PREMIUM_ROLE

    def __init__(self, sessions: IdentityGateway, render_tokens: RenderTokenStore) -> None:
        self.auth = sessions
        self._render_tokens = render_tokens

    @property
    def render_tokens(self) -> RenderTokenStore:
        return self._render_tokens

    def issue_render_token(self, subject: str) -> str:
        return self._render_tokens.issue(subject)

    def redeem_render_token(self, token: str) -> str | None:
        return self._render_tokens.redeem(token)

    def is_premium(self, session: auth.SessionData) -> bool:
        """Whether this session may use the server-side assistant."""
        return True

    def resolve(self, handler) -> auth.SessionData | None:
        """The session for this request, or None if it has no identity yet.

        Common to both deployments, because both reach it: the PDF render always
        issues a render token, and the headless browser doing the render cannot
        log in for itself.
        """
        session = self.auth.get_session(handler.get_cookie(SESSION_COOKIE))
        if session is not None:
            return session
        token = (query_of(handler).get("renderToken") or [""])[0]
        if not token:
            return None
        sub = self._render_tokens.redeem(token)
        if not sub:
            return None
        # Scoped to the render itself, not a normal 24h login: this cookie only
        # exists so the headless render can act as the requesting user for the
        # one page load it needs.
        ttl = self._render_tokens.ttl_seconds
        session_id = self.auth.create_session(sub, "", "", ttl=ttl)
        queue_session_cookie(handler, session_id, max_age=ttl)
        return self.auth.get_session(session_id)


class OidcIdentity(Identity):
    """Accounts behind an OIDC provider -- the hosted deployment.

    Adds nothing to the base: a session comes from the login flow (or from a
    render token), full stop. In particular it does **not** honour the master
    token that LocalIdentity accepts. That token is an unauthenticated bearer
    secret by design, so accepting it here would be a straight bypass of the
    provider for anyone who ever saw one -- and in a hosted deployment the
    people who can read a process environment are not the people with accounts.
    """

    login_url = "/login"
    multi_user = True

    def __init__(
        self,
        sessions: IdentityGateway,
        render_tokens: RenderTokenStore,
        *,
        premium_role: str = DEFAULT_PREMIUM_ROLE,
    ) -> None:
        super().__init__(sessions, render_tokens)
        self.premium_role = premium_role

    def is_premium(self, session: auth.SessionData) -> bool:
        """The assistant runs on the operator's hardware or bill, so a hosted
        account needs the premium role from its verified ID token."""
        return self.premium_role in session.roles

    def resolve(self, handler) -> auth.SessionData | None:
        """The base session, refreshed once its access token has run out.

        The refresh re-reads the roles, so a role the provider withdrew or
        granted counts from the next request on. When the provider ends the
        login (`invalid_grant`) the session is gone and the request has none.
        """
        session = super().resolve(handler)
        if session is None:
            return None
        return self.auth.refresh_session(session.session_id)


class LocalIdentity(Identity):
    """The single person at this machine -- desktop, CLI, a source checkout.

    There is no login page and no account to pick; the question is only whether
    the request really comes from this machine's owner. Three ways to show that,
    tried in order after the base class's cookie/render-token check:

      1. `Authorization: Bearer <token>` -- for scripts and the MCP server.
      2. `?code=<code>` -- a one-time open code (issue_open_code), what the desktop
         window and `quiltor run` open; or `?token=<token>` typed by hand. Both are
         answered with a redirect that drops the parameter again.
      3. The server is bound to loopback -- the ordinary desktop case.
    """

    #: The owner every locally created world carries. Same value the database
    #: has always written for an unclaimed world, so the local user sees their
    #: own worlds without a migration.
    login_url = None
    multi_user = False

    def __init__(
        self,
        owner_store: OwnerIdentityStore,
        sessions: IdentityGateway,
        render_tokens: RenderTokenStore,
        master_token: str,
    ) -> None:
        """Use the process token injected by the composition root.

        Nothing is read from or written to disk, and that is the whole point:
        "the token is never stored in plain text" is then literally true rather
        than a claim about file permissions. Storing it encrypted would only
        move the problem -- the key would have to sit next to the ciphertext,
        readable by exactly the same process -- so a fresh in-memory secret per
        start buys the same property with no crypto and nothing to leak. The
        cost is that a restart invalidates outstanding links, which is correct:
        a token that outlives the process it belonged to is a credential.
        """
        super().__init__(sessions, render_tokens)
        self.master_sub = owner_store.local_owner_id
        self.token = master_token
        # Whether reaching the loopback port is proof enough (S269-4). True only for the
        # source-checkout server the suites and `npm start` talk to. The desktop window and
        # `quiltor run` turn it off: on a machine with several OS accounts the port is open
        # to all of them, so only whoever started the process -- and was handed the token
        # in the URL it opened -- is the owner. See require_token().
        self.trust_loopback = True
        self._clock: Callable[[], float] = time.monotonic
        self._lock = threading.Lock()
        # One-time open codes (F-269-11): digest -> expiry on self._clock.
        self._open_codes: dict[bytes, float] = {}
        # Digests of every owner cookie this process handed out (F-269-10). Such a
        # cookie stays good for as long as the process lives, idle or not.
        self._owner_cookies: set[bytes] = set()

    def issue_open_code(self) -> str:
        """A short-lived, single-use code that opens the app as the owner (F-269-11).

        This is what the desktop window and `quiltor run` put into the URL they open,
        instead of the process token: a launched browser's command line is readable by
        every account on the machine, and a code that is spent on the first request
        and dead after OPEN_CODE_TTL anyway is worth nothing there.
        """
        code = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._purge_open_codes(now)
            if len(self._open_codes) >= MAX_OPEN_CODES:
                oldest = min(self._open_codes, key=self._open_codes.__getitem__)
                del self._open_codes[oldest]
            self._open_codes[_digest(code)] = now + OPEN_CODE_TTL
        return code

    def _redeem_open_code(self, code: str) -> bool:
        supplied = _digest(code)
        now = self._clock()
        with self._lock:
            self._purge_open_codes(now)
            match = None
            # Every held digest is compared, in constant time each, so neither a
            # hit nor its position shows in the timing.
            for held in list(self._open_codes):
                if hmac.compare_digest(held, supplied):
                    match = held
            if match is None:
                return False
            del self._open_codes[match]
            return True

    def _purge_open_codes(self, now: float) -> None:
        for held, expires in list(self._open_codes.items()):
            if now >= expires:
                del self._open_codes[held]

    def require_token(self) -> None:
        """Stop treating a loopback connection as the owner (S269-4)."""
        self.trust_loopback = False

    def resolve(self, handler) -> auth.SessionData | None:
        session = super().resolve(handler)
        if session is not None:
            return self._renewed(handler, session)
        revived = self._revived(handler)
        if revived is not None:
            return revived

        header = (handler.headers.get("Authorization") or "").strip()
        if header.lower().startswith("bearer "):
            if hmac.compare_digest(header[7:].strip(), self.token):
                return self._master_session(handler)
            return None

        query = query_of(handler)
        code = (query.get("code") or [""])[0]
        if code:
            if not self._redeem_open_code(code):
                return None
            session = self._master_session(handler)
            setattr(handler, REDIRECT_ATTR, path_without(handler, "code"))
            return session

        supplied = (query.get("token") or [""])[0]
        if supplied:
            if not hmac.compare_digest(supplied, self.token):
                return None
            session = self._master_session(handler)
            # The secret is in the URL now, which means it is in the address
            # bar, the history and every Referer the page sends. The cookie is
            # already queued, so the same path without the parameter works --
            # tell the dispatch to send the browser there.
            setattr(handler, REDIRECT_ATTR, path_without(handler, "token"))
            return session

        if self.trust_loopback and handler.server_bound_to_loopback():
            # The source-checkout server only (see __init__). There, whoever can
            # reach the port is the developer we would be authenticating anyway;
            # the Host/Origin/Content-Type guard is what stops a web page the user
            # happens to visit from posting to us.
            return self._master_session(handler)
        return None

    def _renewed(self, handler, session: auth.SessionData) -> auth.SessionData:
        """Keep the owner's cookie alive for as long as the window is in use.

        Without loopback trust the cookie is the only proof the window has, and a
        session ends after SESSION_TTL. A desktop window open for longer than that
        would lose access with no way to show the token again, so a request that
        proves the owner's session in its second half gets a fresh one. Whoever holds
        that cookie already holds the owner's access; renewing it widens nothing.
        """
        if (
            self.trust_loopback
            or session.sub != self.master_sub
            # A render token's session is short on purpose and stays that way.
            or session.expires_at - session.created_at < self.auth.session_ttl
            or session.expires_at - time.time() > self.auth.session_ttl / 2
        ):
            return session
        session_id = self.auth.create_session(self.master_sub, "", "")
        self._queue_owner_cookie(handler, session_id)
        return self.auth.get_session(session_id) or session

    def _revived(self, handler) -> auth.SessionData | None:
        """The owner's session again, after the store let it lapse (F-269-10).

        A desktop window left alone overnight sends no request for longer than the
        session lives, so the store drops it -- and with it the only proof the window
        has, taking unsaved changes down with the next save. A cookie this process
        handed to its owner therefore stays good while the process lives: it was only
        ever given to whoever held the token or an open code, and a restart ends it.
        Render sessions and every other subject never get here.
        """
        if self.trust_loopback:
            return None
        cookie = handler.get_cookie(SESSION_COOKIE)
        if not cookie:
            return None
        with self._lock:
            known = _digest(cookie) in self._owner_cookies
        if not known:
            return None
        session_id, session = self.auth.owner_session(self.master_sub)
        self._queue_owner_cookie(handler, session_id)
        return session

    def _queue_owner_cookie(self, handler, session_id: str) -> None:
        if self.trust_loopback:
            queue_session_cookie(handler, session_id, max_age=self.auth.session_ttl)
            return
        with self._lock:
            self._owner_cookies.add(_digest(session_id))
        # A browser-session cookie: no Max-Age the browser could run out on its own while
        # the window stays open. It ends with the browser, the session with the process.
        queue_session_cookie(handler, session_id, max_age=None)

    def _master_session(self, handler) -> auth.SessionData | None:
        """The local user's session, queueing its cookie so the rest of this page
        load -- and the requests that follow -- need no token.

        One session for the whole process, not one per request. A client that
        keeps no cookies (curl, a Bearer-carrying script, the test suite) would
        otherwise mint a fresh entry on every call, and a session store only drops
        entries once they expire -- 24h of polling would be 24h of sessions. One
        local user is one session; reusing it is not an optimisation but the
        accurate model.
        """
        session_id, session = self.auth.owner_session(self.master_sub)
        self._queue_owner_cookie(handler, session_id)
        return session


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


# ------------------------------------------------------- Handler plumbing
#
# Small helpers rather than handler methods: they are what an identity needs
# from a request, and keeping them here means a test can drive the identities
# with a stub object instead of a running server.


def query_of(handler) -> dict[str, list[str]]:
    """The request's query parameters, parsed from the handler's raw path."""
    result: dict[str, list[str]] = {}
    for key, value in parse_qsl(urlsplit(handler.path).query, keep_blank_values=True):
        result.setdefault(key, []).append(value)
    return result


def path_without(handler, name: str) -> str:
    """The same request path with one query parameter removed."""
    parts = urlsplit(handler.path)
    remaining = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != name]
    return urlunsplit(("", "", parts.path or "/", urlencode(remaining), parts.fragment))


def queue_session_cookie(handler, session_id: str, *, max_age: int | None) -> None:
    """Queue the session cookie on the response the handler is about to send."""
    handler._pending_cookies.append(
        handler.cookie_header(SESSION_COOKIE, session_id, max_age=max_age)
    )


__all__ = [
    "DEFAULT_PREMIUM_ROLE",
    "REDIRECT_ATTR",
    "SESSION_COOKIE",
    "Identity",
    "LocalIdentity",
    "OidcIdentity",
    "path_without",
    "query_of",
    "queue_session_cookie",
]
