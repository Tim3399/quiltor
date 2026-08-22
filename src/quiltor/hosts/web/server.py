#!/usr/bin/env python3
"""
Quiltor — small local writing server

Two workspaces at one address; SQLite is the authoritative store:
  · Worlds                            → data/worlds/<world-id>.sqlite3
  · Characters  Relationship graph and profiles in SQLite
                readable profiles   → data/profiles/<world-id>/NN - Name.md
  · Text        Manuscript in SQLite
  · Backup      Snapshot and upload from the UI
  · History     Human-readable changes
                                     → data/manuscripts/<world-id>/NN - Title.md

Starten:
    python3 apps/web/server.py                 # port 8000, opens the browser
    python3 apps/web/server.py 8080            # custom port
    python3 apps/web/server.py 8080 --no-open  # do not open a browser

Stop: Ctrl+C

The core package installs its small runtime dependencies, including audited
OIDC signature verification. On first run, if no local AI assistant is set up
yet, you'll be asked once whether to download one
(llama.cpp + a GGUF model, or MLX on Apple Silicon) — answer no and Quiltor
runs exactly the same, just without the assistant panel.

Every request has a session, in both shapes Quiltor runs in; what differs is
only who the users are. Setting QUILTOR_OIDC_ISSUER installs the OIDC identity:
Keycloak login, accounts, per-user world isolation — see README for the required
env vars. With it unset (the default), the local identity is installed instead:
one user, the person at this machine, recognised by a loopback connection, a
`?token=` link or a Bearer token, and no login page at all. Each Server owns an
explicitly composed WebApplication; importing this module creates no sessions,
stores, assistant process, or other product state.
"""

import http.cookies
import http.server
import hmac
import json
import os
import socketserver
import sys
import threading
import time
import webbrowser
from typing import Any
from urllib.parse import parse_qs, urlparse

from quiltor.bootstrap import LOOPBACK_HOSTS, WebApplication, WebWorldContext, build_web_application
from quiltor.delivery.http import errors as http_errors
from quiltor.infrastructure.platform.system import force_utf8_streams

from quiltor.modules.identity import service as identity
from quiltor.delivery.http import routes as api_routes
from quiltor.modules.identity.service import SESSION_COOKIE

MAX_BODY = 16 * 1024 * 1024  # 16 MB limit per save request


# ------------------------------------------------- Local-mode request guard
#
# This is CSRF defence, not authentication -- the two are separate jobs and this
# one is not made redundant by the other. Every request now resolves to a
# session, and locally that session is handed out to
# anything that reaches the loopback port, which is exactly the problem: a
# browser sends our cookie along with a cross-origin request, so the attacker's
# page borrows the local user's identity rather than needing one. Loopback is
# not a security boundary in a browser. A plain
#
#   <form method="POST" enctype="text/plain"
#         action="http://127.0.0.1:8843/api/manuscript">
#
# is a CORS-"simple" request -- no preflight, so nothing ever asks our
# permission -- and would overwrite the manuscript. The same-origin policy
# stops the attacker reading the response, but the write already happened.
#
# Three cheap header checks close that, and none of them apply to the
# reverse-proxied Docker deployment, which binds 0.0.0.0, answers to a real
# hostname and has OIDC in front of it:
#
#   1. Host must be loopback. Without this, DNS rebinding works: an
#      attacker-controlled name is made to resolve to 127.0.0.1, and their
#      page becomes same-origin with us -- which also makes reads possible.
#   2. A cross-origin Origin is refused. Browsers send Origin on every
#      cross-origin POST, so this is what actually catches the form above. A
#      *missing* Origin means a non-browser client (curl, the test suite),
#      which is not the threat being modelled here.
#   3. JSON bodies must really be Content-Type: application/json -- an HTML
#      form can only ever send text/plain, urlencoded or multipart, so this
#      alone already breaks the attack. Enforced in _read_json_body().
#
# Checks 1 and 2 compare the *hostname* and ignore the port, deliberately. Vite's
# dev proxy forwards `/api` without rewriting Host (changeOrigin defaults to
# false), so `npm run dev` arrives here as localhost:5173 and would otherwise be
# refused. The cost is that another server on a different loopback port could
# still post to us -- a far narrower threat than "any website the user visits",
# and one that already implies something hostile is running locally.
def authority_host(authority: str) -> str:
    """Hostname out of a `name:port` authority, IPv6 brackets stripped."""
    if authority.startswith("["):
        closing = authority.find("]")
        return authority[1:closing] if closing > 0 else authority
    return authority.rsplit(":", 1)[0] if ":" in authority else authority


LOGIN_STATE_COOKIE = "quiltor_login_state"

# Populates api_routes.GET / api_routes.SAVE. At import time rather than on the
# first request, so a broken route module fails at startup instead of as a 404.
api_routes.load()


class Handler(http.server.SimpleHTTPRequestHandler):
    @property
    def application(self) -> WebApplication:
        return self.server.application

    def __init__(self, request, client_address, server):
        # Only the built Vite client is public; databases and mirrors stay private.
        # Never fall back to BASE: that would serve data/worlds/*.sqlite3, backups,
        # and source alongside the app. If dist/ is missing, static GETs just 404.
        super().__init__(
            request,
            client_address,
            server,
            directory=str(server.application.public_assets),
        )

    def send_response(self, code: int, message: str | None = None) -> None:
        self._response_status = int(code)
        super().send_response(code, message)

    def send_json(self, obj, code: int = 200, headers: dict | None = None) -> None:
        obj, code = http_errors.normalize_response(obj, code)
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

    def send_api_error(
        self,
        code: int,
        *,
        error_code: str = "",
        retryable: bool | None = None,
    ) -> None:
        error = http_errors.for_status(code, code=error_code, retryable=retryable)
        self.send_json(error.payload(), error.status)

    def send_exception(self, error: Exception) -> None:
        response = http_errors.from_exception(error)
        self.send_json(response.payload(), response.status)

    def send_pdf(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", 'attachment; filename="Quiltor-Buchfassung.pdf"')
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Any:
        """Read and parse the request's JSON body, capped at MAX_BODY so a
        client-controlled Content-Length can't force an unbounded read. Raises
        ValueError/json.JSONDecodeError on an invalid size or malformed JSON --
        callers that want a default instead of propagating wrap this themselves."""
        # An HTML form can only ever send text/plain, urlencoded or multipart,
        # so insisting on application/json is what makes cross-site form posts
        # impossible regardless of the Origin check -- see the guard comment at
        # the top of this file. Every in-tree client already sets it.
        media_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            raise ValueError("ungültiger Content-Type")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("ungültige Größe")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def reject_foreign_request(self) -> bool:
        """True -- with a 403 already written -- when this request's Host or
        Origin says it did not come from the local app itself. No-op for the
        proxied deployment, where the proxy owns Host and OIDC owns access."""
        if not self.application.bound_to_loopback:
            return False

        host = authority_host(self.headers.get("Host", ""))
        if host and host not in LOOPBACK_HOSTS:
            self.send_json(
                http_errors.for_status(
                    403, code="request.untrusted_host", retryable=False
                ).payload(),
                403,
            )
            return True

        origin = (self.headers.get("Origin") or "").strip()
        # "null" is what a sandboxed iframe or a file:// page sends; it is never
        # us, so it gets refused alongside any other foreign origin.
        if origin and (
            origin == "null" or authority_host(urlparse(origin).netloc) not in LOOPBACK_HOSTS
        ):
            self.send_json(
                http_errors.for_status(
                    403, code="request.untrusted_origin", retryable=False
                ).payload(),
                403,
            )
            return True
        return False

    def end_headers(self) -> None:
        # Any Set-Cookie headers queued by the auth routes ride along on whatever
        # response actually gets sent (send_json/send_pdf/redirect/static fallback).
        for key, value in getattr(self, "_pending_cookies", None) or []:
            self.send_header(key, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # Suppress default noise; meaningful operations are logged explicitly.

    # ---------- Auth helpers ----------

    def get_cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(name)
        return morsel.value if morsel else None

    def server_bound_to_loopback(self) -> bool:
        """Whether this process listens on loopback only.

        A handler method purely so the identity module can ask without importing
        this host. The handler is the one object
        both sides already share, so it carries the answer across.
        """
        return self.application.bound_to_loopback

    def cookie_secure(self) -> bool:
        if (
            self.application.public_url
            and urlparse(self.application.public_url).scheme.lower() == "https"
        ):
            return True
        override = os.environ.get("QUILTOR_COOKIE_SECURE", "auto")
        if override == "1":
            return True
        if override == "0":
            return False
        return False

    def cookie_header(self, name: str, value: str, max_age: int | None) -> tuple[str, str]:
        morsel = http.cookies.SimpleCookie()
        morsel[name] = value
        morsel[name]["path"] = "/"
        morsel[name]["httponly"] = True
        morsel[name]["samesite"] = "Lax"
        if self.cookie_secure():
            morsel[name]["secure"] = True
        if max_age is not None:
            morsel[name]["max-age"] = max_age
        return ("Set-Cookie", morsel.output(header="").strip())

    def public_base_url(self) -> str:
        if self.application.public_url:
            return self.application.public_url
        scheme = "https" if self.cookie_secure() else "http"
        host = self.headers.get("Host", "localhost")
        return f"{scheme}://{host}"

    def send_redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_login(self) -> None:
        redirect_uri = f"{self.public_base_url()}/auth/callback"
        authorize_url, state = self.application.identity.auth.start_login(redirect_uri)
        self._pending_cookies.append(self.cookie_header(LOGIN_STATE_COOKIE, state, max_age=600))
        return self.send_redirect(authorize_url)

    def handle_auth_callback(self) -> None:
        # Every failure below sends the browser back to "/" with a reason code
        # instead of a bare JSON error: the frontend has nothing to render a
        # JSON blob into at this point (no world is open, often no session),
        # but it can always show its own sign-in screen again, this time with
        # an explanation. See packages/client/src/modules/identity/SignInGate.tsx, which reads
        # ?authError= off the URL.
        q = parse_qs(urlparse(self.path).query)
        if (q.get("error") or [""])[0]:
            return self.send_redirect("/?authError=provider")
        code = (q.get("code") or [""])[0]
        state = (q.get("state") or [""])[0]
        cookie_state = self.get_cookie(LOGIN_STATE_COOKIE)
        if (
            not code
            or not state
            or not cookie_state
            or not hmac.compare_digest(state, cookie_state)
        ):
            return self.send_redirect("/?authError=state")
        pending = self.application.identity.auth.consume_pending_login(state)
        if pending is None:
            return self.send_redirect("/?authError=expired")
        try:
            tokens = self.application.identity.auth.exchange_code(
                code, pending["verifier"], pending["redirect_uri"]
            )
            claims = self.application.identity.auth.verify_id_token(
                tokens["id_token"], pending["nonce"]
            )
        except Exception as exc:
            self.application.observability.logger.event(
                "warning",
                "identity.token_exchange_failed",
                error_type=type(exc).__name__,
            )
            return self.send_redirect("/?authError=exchange")
        session_id = self.application.identity.auth.create_session(
            str(claims.get("sub", "")),
            str(claims.get("email", "")),
            str(claims.get("name") or claims.get("preferred_username") or ""),
        )
        # Keep the provider's own tokens on the session. In this deployment the
        # backup endpoint is guarded by the very issuer this login just went
        # through, so the access token that came back is already the one that
        # endpoint asks for -- _backup_token hands it straight on and a hosted
        # user never sees a second login. Set here rather than passed into
        # The injected identity gateway owns the session store; whether provider
        # tokens are worth keeping is this host's judgement, not the store's.
        # Nobody else can reach the session yet; its cookie goes out below.
        session = self.application.identity.auth.get_session(session_id)
        if session is not None:
            self.application.identity.auth.store_session_tokens(
                session.session_id,
                tokens,
                verified_id_token=str(tokens["id_token"]),
            )
        self._pending_cookies.append(
            self.cookie_header(
                SESSION_COOKIE,
                session_id,
                max_age=self.application.identity.auth.session_ttl,
            )
        )
        self._pending_cookies.append(self.cookie_header(LOGIN_STATE_COOKIE, "", max_age=0))
        return self.send_redirect("/")

    def handle_logout(self) -> None:
        session_id = self.get_cookie(SESSION_COOKIE)
        session = self.application.identity.auth.get_session(session_id)
        logout_url = (
            self.application.identity.auth.end_session_url(
                id_token_hint=session.id_token if session is not None else None,
                post_logout_redirect_uri=(
                    f"{self.application.public_url}/" if self.application.public_url else None
                ),
            )
            if self.application.identity.multi_user
            else None
        )
        self.application.identity.auth.destroy_session(session_id)
        self._pending_cookies.append(self.cookie_header(SESSION_COOKIE, "", max_age=0))
        self._pending_cookies.append(self.cookie_header(LOGIN_STATE_COOKIE, "", max_age=0))
        return self.send_json({"ok": True, "logoutUrl": logout_url or ""})

    def _resolve_world_or_respond(self, session, world_id: str) -> WebWorldContext | None:
        try:
            return self.application.resolve_world(session, world_id)
        except ValueError as exc:
            self.send_exception(exc)
        except PermissionError as exc:
            self.send_exception(exc)
        except FileNotFoundError as exc:
            self.send_exception(exc)
        return None

    def world_from_body(self, session, payload) -> "WebWorldContext | None":
        """The world named by the body's `worldId`. None means the answer has
        already been written. Separate from registration.world because the id
        only exists here once the body has been read -- five save routes carry
        it there instead of in the query string, and they all resolve it the
        same way. A payload that is not an object resolves like an empty id: a
        400, which is what a request naming no world deserves.
        """
        world_id = str(payload.get("worldId", "")) if isinstance(payload, dict) else ""
        return self._resolve_world_or_respond(session, world_id)

    # ---------- Dispatch ----------
    #
    # The routes themselves live in src/quiltor/delivery/http/routes/, grouped by subject.
    # What stays here is the order they depend on and must not lose: the
    # cross-origin guard first, then the identity resolving the session
    # (including a render token or a `?token=` redeeming into one), then the
    # gate for requests that resolved to nobody, then -- only for routes that
    # asked for it -- resolving the caller's world.

    def serve_client(self) -> None:
        """Hand the request to SimpleHTTPRequestHandler, which serves the built
        Vite client out of dist/. The fallback for anything not an API route."""
        if self.path.split("?")[0] == "/":
            self.path = "/index.html"
        super().do_GET()

    def _dispatch(self, table: dict, *, on_miss) -> None:
        started = time.monotonic()
        self._response_status = 0
        requested_path = self.path.split("?", 1)[0]
        route = (
            requested_path
            if requested_path in table
            else ("unmatched_api" if requested_path.startswith("/api/") else "client_asset")
        )
        try:
            self._dispatch_request(table, on_miss=on_miss)
        except Exception as exc:
            self.application.observability.metrics.increment(
                "http_requests_total",
                method=self.command,
                route=route,
                outcome="failure",
                error_type=type(exc).__name__,
            )
            self.application.observability.logger.event(
                "error",
                "http.request_failed",
                method=self.command,
                route=route,
                error_type=type(exc).__name__,
            )
            if self._response_status:
                raise
            self.send_exception(exc)
        else:
            self.application.observability.metrics.increment(
                "http_requests_total",
                method=self.command,
                route=route,
                outcome=("failure" if self._response_status >= 400 else "success"),
                status=str(self._response_status),
            )
        finally:
            self.application.observability.metrics.observe(
                "http_request_duration_seconds",
                time.monotonic() - started,
                method=self.command,
                route=route,
            )

    def _dispatch_request(self, table: dict, *, on_miss) -> None:
        # Before anything else, and before the identity is consulted: a request
        # from a foreign Host or Origin is refused outright, so a cross-site
        # page never gets as far as borrowing the local user's session.
        self._pending_cookies = []
        # Both are per-request state on an object that http.server may reuse for
        # a second request on the same connection; cleared together so a bounce
        # can never leak into the request after it.
        setattr(self, identity.REDIRECT_ATTR, None)
        if self.reject_foreign_request():
            return
        path = self.path.split("?")[0]
        query = parse_qs(urlparse(self.path).query)
        registration = table.get(path)
        if (
            registration is not None
            and registration.auth_only
            and not self.application.identity.multi_user
        ):
            registration = None  # nothing to choose between when there is one user

        # _pending_cookies must already exist here: resolving queues the session
        # cookie onto this very response.
        session = self.application.identity.resolve(self)
        redirect = getattr(self, identity.REDIRECT_ATTR, None)
        if redirect is not None:
            # A secret came in through the query string. The cookie above is
            # already queued and rides along on the 302 (end_headers sends
            # _pending_cookies), so the bounced request arrives logged in.
            return self.send_redirect(redirect)
        if session is None and not (registration and registration.anonymous):
            if path.startswith("/api/"):
                return self.send_api_error(401)
            if registration is None and self.application.identity.multi_user:
                # No API route, no session: this is the app shell itself
                # (index.html, its JS/CSS) rather than data -- let it load
                # unauthenticated so the app can render its own sign-in screen
                # (packages/client/src/modules/identity/SignInGate.tsx) instead of never getting
                # far enough to show anything at all. Data stays behind
                # /api/*, guarded above, unaffected by this.
                return on_miss()
            if self.application.identity.login_url:
                return self.send_redirect(self.application.identity.login_url)
            # No login page to send anyone to: the request simply is not this
            # machine's owner, and there is nothing they could do about it here.
            return self.send_api_error(403, error_code="auth.forbidden")

        if registration is None:
            return on_miss()

        request = api_routes.Request(path=path, query=query, session=session)
        if registration.world:
            request.world = self._resolve_world_or_respond(session, (query.get("world") or [""])[0])
            if request.world is None:
                return
        registration.handler(self, request, self.application.route_services(path))

    def do_GET(self):
        def on_miss() -> None:
            if self.path.split("?", 1)[0].startswith("/api/"):
                return self.send_api_error(404, error_code="route_not_found")
            return self.serve_client()

        self._dispatch(api_routes.GET, on_miss=on_miss)

    def _save(self):
        def on_miss() -> None:
            if self.path.split("?", 1)[0].startswith("/api/"):
                return self.send_api_error(404, error_code="route_not_found")
            return self.send_error(404)

        self._dispatch(api_routes.SAVE, on_miss=on_miss)

    do_PUT = _save
    do_POST = _save


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, handler_class, application: WebApplication):
        self.application = application
        super().__init__(server_address, handler_class)


def run(
    port: int = 8000,
    no_open: bool = False,
    print_token: bool = False,
    *,
    application: WebApplication | None = None,
) -> None:
    force_utf8_streams()
    app = application or build_web_application()
    app.prepare()
    app.assistant_jobs.start()
    url = f"http://localhost:{port}/"

    print()
    print(f"  Quiltor · Autorenwerkstatt · v{app.version}")
    print("  " + "─" * 52)
    print(f"  Adresse    {url}")
    # The worlds directory, not a single database file: there is no process-wide
    # open world any more, so "the" database is not a thing this process has.
    print(f"  Welten      {app.application.worlds.worlds_directory}")
    print(f"  Backups     {app.backups_directory}")
    # Always printed: there is always an identity, and which one is in force is
    # the single most useful thing to know about a running instance. Never the
    # token -- a secret on a terminal is a secret in a scrollback buffer.
    if app.identity.multi_user:
        print(f"  Identity    Keycloak ({app.identity.auth.issuer})")
    else:
        print("  Identity    lokal (ein Nutzer)")
    if print_token:
        # Only ever on request (--print-token), and only for this process: the
        # token dies with it, so a copied line is not a lasting credential.
        token = getattr(app.identity, "token", "")
        print(
            f"  Token       {token}"
            if token
            else "  Token       — diese Instanz hat keine lokale Identität"
        )
    print("  Stop        Ctrl+C")
    print("  " + "─" * 52)
    print()

    if not no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        # Defaults to loopback-only, matching the local single-user tool's security
        # posture. The Docker image sets QUILTOR_HOST=0.0.0.0 because a container's
        # loopback interface isn't reachable through Docker's port forwarding at all
        # — the reverse proxy in front of it is what actually restricts exposure.
        with Server((os.environ.get("QUILTOR_HOST", "127.0.0.1"), port), Handler, app) as httpd:
            httpd.serve_forever()
    except OSError as exc:
        print(f"  ! Port {port} ist belegt ({exc}).")
        print(f"  ! Versuch es mit:  python3 apps/web/server.py {port + 1}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Stopped. Your work is stored in data/\n")
    finally:
        app.close()


def main(*, application: WebApplication | None = None) -> None:
    argv = sys.argv[1:]
    no_open = "--no-open" in argv
    # The only way the local token is ever shown, and it prints *this* process's
    # secret at startup rather than in a separate run: the token is generated
    # per process, so one printed by any other invocation would be worthless.
    # Without the flag it appears nowhere -- not in the banner, not in a log.
    print_token = "--print-token" in argv
    positional = [a for a in argv if not a.startswith("--")]
    port = int(positional[0]) if positional else 8000
    run(
        port=port,
        no_open=no_open,
        print_token=print_token,
        application=application,
    )


if __name__ == "__main__":
    main()
