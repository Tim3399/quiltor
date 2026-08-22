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

import hmac
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


class LocalIdentity(Identity):
    """The single person at this machine -- desktop, CLI, a source checkout.

    There is no login page and no account to pick; the question is only whether
    the request really comes from this machine's owner. Three ways to show that,
    tried in order after the base class's cookie/render-token check:

      1. `Authorization: Bearer <token>` -- for scripts and the MCP server.
      2. `?token=<token>` -- for opening a URL in a browser that has no cookie
         yet. Answered with a redirect that drops the parameter again.
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

    def resolve(self, handler) -> auth.SessionData | None:
        session = super().resolve(handler)
        if session is not None:
            return session

        header = (handler.headers.get("Authorization") or "").strip()
        if header.lower().startswith("bearer "):
            if hmac.compare_digest(header[7:].strip(), self.token):
                return self._master_session(handler)
            return None

        query = query_of(handler)
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

        if handler.server_bound_to_loopback():
            # The normal desktop/CLI case. A loopback-only instance is one trust
            # domain -- whoever can reach the port is the user we would be
            # authenticating anyway -- so demanding a token here would be
            # ceremony, not security. The boundary that does the work stays the
            # Host/Origin/Content-Type guard, which is what stops a web page the
            # user happens to visit from posting to us.
            return self._master_session(handler)
        return None

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
        queue_session_cookie(handler, session_id, max_age=self.auth.session_ttl)
        return session


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


def queue_session_cookie(handler, session_id: str, *, max_age: int) -> None:
    """Queue the session cookie on the response the handler is about to send."""
    handler._pending_cookies.append(
        handler.cookie_header(SESSION_COOKIE, session_id, max_age=max_age)
    )


__all__ = [
    "REDIRECT_ATTR",
    "SESSION_COOKIE",
    "Identity",
    "LocalIdentity",
    "OidcIdentity",
    "path_without",
    "query_of",
    "queue_session_cookie",
]
