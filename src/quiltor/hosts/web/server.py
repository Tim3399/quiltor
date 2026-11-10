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

With OIDC, the AI assistant is for accounts with the realm role QUILTOR_PREMIUM_ROLE
(default `premium`), read from the ID token's flat `roles` claim at login and at every
refresh; QUILTOR_ASSISTANT_MAX_OPEN_JOBS (default 3, 1-100) bounds the open jobs per
account. A key in QUILTOR_AI_KEY or QUILTOR_AI_KEY_FILE sends inference to the
OpenAI-compatible endpoint at QUILTOR_AI_URL instead of a local runtime, with
QUILTOR_AI_MODEL_NAME as the model and QUILTOR_AI_JSON_MODE=json_object for providers
that ignore json_schema. See the README for all of them.
"""

import hmac
import http.cookies
import http.server
import json
import os
import socketserver
import sqlite3
import sys
import threading
import time
import traceback
import webbrowser
from typing import Any, Literal, cast
from urllib.parse import parse_qs, urlparse

from quiltor.application import ApplicationError
from quiltor.bootstrap import LOOPBACK_HOSTS, WebApplication, WebWorldContext, build_web_application
from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http import routes as api_routes
from quiltor.infrastructure.observability import schema as log_schema
from quiltor.infrastructure.platform.system import force_utf8_streams
from quiltor.modules.identity import service as identity
from quiltor.modules.identity.service import SESSION_COOKIE

MAX_BODY = 16 * 1024 * 1024  # 16 MB limit per save request
REQUEST_HEADER_TIMEOUT_SECONDS = 15.0

# How much of a refused request's body is read and thrown away before the answer.
#
# Closing a Windows socket with unread request bytes resets the connection, and the
# client loses the 401, 403 or 404 that was already on its way (WinError 10053).
# Reading the body first lets the close be orderly. A refused request deserves only a
# bounded effort, though: 64 KiB covers any form post or JSON call that gets refused
# before its route runs, and costs one buffered read. A larger body, or one without a
# valid Content-Length, is not read -- the connection is closed as before -- and a body
# that does not arrive within the timeout is given up on, so a refused client cannot
# make us wait.
REFUSED_BODY_DISCARD_LIMIT = 64 * 1024
REFUSED_BODY_DISCARD_TIMEOUT_SECONDS = 2.0

RequestBodyRejectionReason = Literal[
    "missing_length",
    "invalid_length",
    "too_large",
    "content_type",
    "utf8",
    "json",
]


class RequestBodyRejected(ValueError):
    """A JSON request the server can refuse without logging its contents."""

    def __init__(self, reason: RequestBodyRejectionReason) -> None:
        message = {
            "missing_length": "invalid size: missing Content-Length",
            "invalid_length": "invalid size",
            "too_large": "invalid size",
            "content_type": "invalid Content-Type",
            "utf8": "invalid UTF-8",
            "json": "invalid JSON",
        }[reason]
        super().__init__(message)
        self.reason = reason


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


_DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin_of(url: str, *, allow_path: bool) -> str | None:
    """`scheme://host[:port]` of a URL in one canonical form, or None when it is not one.

    Scheme and host are lower-cased and the scheme's default port is dropped, so
    `https://Example.com:443` and `https://example.com` are the same origin. An
    Origin header carries nothing after the authority (`allow_path=False`); the
    configured public URL may have a path when the app is served under one.
    """
    try:
        parts = urlparse(url)
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if scheme not in _DEFAULT_PORTS or not host or parts.username is not None:
        return None
    if parts.password is not None or parts.query or parts.fragment:
        return None
    if not allow_path and parts.path:
        return None
    shown = f"[{host}]" if ":" in host else host
    return f"{scheme}://{shown}" + (
        f":{port}" if port not in (None, _DEFAULT_PORTS[scheme]) else ""
    )


# The interface languages the identity provider is configured for (T-175).
LOGIN_UI_LOCALES = frozenset({"de", "en"})
LOGIN_STATE_COOKIE = "quiltor_login_state"

REQUEST_ID_HEADER = "X-Request-Id"


def _note_session(session) -> None:
    """Put the resolved session's `sub` into the request's log context. Never email
    or name: `sub` is the one identifier an operator needs to find the user."""
    request = log_schema.current_request.get()
    if request is not None and session is not None:
        request.sub = getattr(session, "sub", None) or None


_LOGGED_ATTR = "_quiltor_logged_unhandled"


def _exception_text(exc: BaseException) -> str:
    """What an exception may say about itself in a log line.

    A foreign exception's text can carry what the author wrote -- a KeyError names
    the key, a JSONDecodeError quotes the document -- so only types whose text is
    the code's own are spoken: an application error's code, sqlite's error name, and
    an OSError that names no file. sqlite's message itself can carry a path or a
    quoted value, so it never is.
    """
    if isinstance(exc, ApplicationError):
        return str(exc.code)
    if isinstance(exc, sqlite3.Error):
        name = getattr(exc, "sqlite_errorname", None)
        return name if isinstance(name, str) else ""
    if isinstance(exc, OSError) and exc.filename is None and exc.filename2 is None:
        return str(exc)
    return ""


def _safe_traceback(exc: BaseException) -> str:
    """Frames and type names of `exc` and its chain, with _exception_text as the only
    message. The frames are source locations, not data."""
    blocks: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text = _exception_text(current)
        name = type(current).__qualname__
        frames = "".join(traceback.format_tb(current.__traceback__))
        last = f"{name}: {text}" if text else name
        blocks.append(f"Traceback (most recent call last):\n{frames}{last}")
        current = current.__cause__ or (
            None if current.__suppress_context__ else current.__context__
        )
    return "\n\nwhile handling:\n\n".join(reversed(blocks))


# Populates api_routes.GET / api_routes.SAVE. At import time rather than on the
# first request, so a broken route module fails at startup instead of as a 404.
api_routes.load()


def is_html(content_type: str) -> bool:
    return content_type.strip().lower().startswith("text/html")


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def application(self) -> WebApplication:
        return cast(Server, self.server).application

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

    def handle_one_request(self) -> None:
        """Bound idle keep-alive sockets and clear state before every parse."""
        self._pending_cookies = []
        setattr(self, identity.REDIRECT_ATTR, None)
        self._response_status = 0
        self._sent_connection_header = False
        self._content_type = ""
        self._error_code = None
        self._bytes_out = 0
        self.connection.settimeout(REQUEST_HEADER_TIMEOUT_SECONDS)
        super().handle_one_request()

    def parse_request(self) -> bool:
        parsed = super().parse_request()
        if not parsed:
            return False

        # The timeout only bounds an idle socket and request headers. Once framing is
        # known, uploads and route handlers retain their previous unbounded behavior.
        self.connection.settimeout(None)

        connection_tokens = {
            token.strip().lower()
            for value in self.headers.get_all("Connection", ())
            for token in value.split(",")
            if token.strip()
        }
        has_request_body_or_upgrade = any(
            self.headers.get(name) is not None
            for name in ("Content-Length", "Transfer-Encoding", "Expect", "Upgrade")
        )
        may_persist = (
            self.command == "GET"
            and self.request_version == "HTTP/1.1"
            and not has_request_body_or_upgrade
            and "close" not in connection_tokens
            and "upgrade" not in connection_tokens
        )
        if not may_persist:
            self.close_connection = True
        return True

    def send_response(self, code: int, message: str | None = None) -> None:
        self._response_status = int(code)
        super().send_response(code, message)

    def send_header(self, keyword: str, value: str) -> None:
        if keyword.lower() == "connection":
            self._sent_connection_header = True
        elif keyword.lower() == "content-type":
            self._content_type = value
        elif keyword.lower() == "content-length":
            # Every body this server writes declares its length -- JSON, PDF, images,
            # redirects and the static files SimpleHTTPRequestHandler serves -- so the
            # header is the one place that counts bytes_out for all of them.
            try:
                self._bytes_out = int(value)
            except ValueError:
                self._bytes_out = 0
        super().send_header(keyword, value)

    def send_json(self, obj, code: int = 200, headers: dict | None = None) -> None:
        obj, code = http_errors.normalize_response(obj, code)
        # After normalize_response, never before: it rebuilds `error` from a fixed set
        # of keys and would drop the id again. Reading the code here, where every JSON
        # answer passes, also catches errors written without send_api_error -- the 403s
        # of reject_foreign_request and the 500 normalize_response itself produces.
        if isinstance(obj, dict) and obj.get("ok") is False and isinstance(obj.get("error"), dict):
            self._error_code = obj["error"].get("code")
            request = log_schema.current_request.get()
            if request is not None:
                obj = {**obj, "error": {**obj["error"], "requestId": request.request_id}}
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
        if response.log_fields:
            self.application.observability.logger.event(
                "error", "storage.failed", **response.log_fields
            )
        self.send_json(response.payload(), response.status)

    def send_pdf(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", 'attachment; filename="Quiltor-Buchfassung.pdf"')
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_image(self, media_type: str, body: bytes, digest: str) -> None:
        """Serve a stored map image, the one user-supplied binary this app returns.

        `media_type` comes from the leading bytes at upload time, never from
        what the uploader claimed, and the headers below stop a browser from
        looking for a second opinion: without `nosniff` a file that begins as
        one thing and continues as markup can still be treated as a document on
        this origin, and the app sends no Content-Security-Policy of its own.
        The sandbox directive makes a direct navigation to the image an opaque
        origin, so even then it would have nothing to reach for.

        The id is the content digest, so a given URL can only ever answer with
        the same bytes and the response may be cached indefinitely. `private`
        keeps that copy in the one browser that was allowed to ask.
        """

        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", "inline")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
        self.send_header("Cache-Control", "private, max-age=31536000, immutable")
        self.send_header("ETag", f'"{digest}"')
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Any:
        """Read and parse the request's JSON body, capped at MAX_BODY so a
        client-controlled Content-Length can't force an unbounded read. Raises a
        RequestBodyRejected with a safe reason bucket for invalid framing or
        content; callers that want a default instead of propagating wrap it."""
        # An HTML form can only ever send text/plain, urlencoded or multipart,
        # so insisting on application/json is what makes cross-site form posts
        # impossible regardless of the Origin check -- see the guard comment at
        # the top of this file. Every in-tree client already sets it.
        declared_length = self.headers.get("Content-Length")
        if declared_length is None or not declared_length.strip():
            raise RequestBodyRejected("missing_length")
        try:
            length = int(declared_length)
        except ValueError as error:
            raise RequestBodyRejected("invalid_length") from error
        if length <= 0:
            raise RequestBodyRejected("invalid_length")
        if length > MAX_BODY:
            raise RequestBodyRejected("too_large")
        body = self.read_request_body(length)
        media_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            # Drain the already bounded request body before sending the error response.
            # Closing a Windows socket with unread request bytes can reset the connection
            # and discard the JSON error response before the client receives it.
            raise RequestBodyRejected("content_type")
        try:
            decoded = body.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RequestBodyRejected("utf8") from error
        try:
            return json.loads(decoded)
        except json.JSONDecodeError as error:
            raise RequestBodyRejected("json") from error

    def reject_foreign_request(self) -> bool:
        """True -- with a 403 already written -- when this request's Host or
        Origin says it did not come from the app itself.

        Bound to loopback, Host and Origin must both be loopback. Behind a proxy
        the proxy owns Host and OIDC owns access, so only one check remains: with
        QUILTOR_PUBLIC_URL set, a write (anything but GET and HEAD) that carries an
        Origin must carry exactly the public URL's scheme, host and port, with the
        default port normalised; `null` is refused. A write without an Origin passes
        -- curl and the CLI send none, and a browser always sends one cross-site --
        and so does every read. Without QUILTOR_PUBLIC_URL there is nothing to
        compare with and the proxied case stays a no-op."""
        if not self.application.bound_to_loopback:
            return self._reject_foreign_public_origin()

        host = authority_host(self.headers.get("Host", ""))
        if host and host not in LOOPBACK_HOSTS:
            self._discard_unread_body()
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
            return self._refuse_untrusted_origin()
        return False

    def _reject_foreign_public_origin(self) -> bool:
        """The proxied deployment's half of reject_foreign_request."""
        public_origin = _origin_of(self.application.public_url, allow_path=True)
        if public_origin is None or self.command in {"GET", "HEAD"}:
            return False
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return False
        if origin == "null" or _origin_of(origin, allow_path=False) != public_origin:
            return self._refuse_untrusted_origin()
        return False

    def _refuse_untrusted_origin(self) -> bool:
        """Answer 403 `request.untrusted_origin`, after dropping the unread body (D-38)."""
        self._discard_unread_body()
        self.send_json(
            http_errors.for_status(403, code="request.untrusted_origin", retryable=False).payload(),
            403,
        )
        return True

    def read_request_body(self, length: int) -> bytes:
        """Read the request body. Every route that reads it goes through here, so
        the dispatcher knows afterwards whether a refusal left it unread."""
        self._request_body_read = True
        return self.rfile.read(length)

    def _discard_unread_body(self) -> None:
        """Read and drop a small body that no route has read, so the close does not
        reset the connection; see REFUSED_BODY_DISCARD_LIMIT. Anything unbounded,
        invalid or slow is left unread. Called for refusals before a route runs, and
        after a route that answered or raised without reading the body -- only when
        `_request_body_read` is still false, since a read body is gone from the socket
        and waiting for it again would stall until the deadline."""
        if self.headers.get("Transfer-Encoding"):
            return
        try:
            length = int((self.headers.get("Content-Length") or "").strip())
        except ValueError:
            return
        if length <= 0 or length > REFUSED_BODY_DISCARD_LIMIT:
            return
        # One deadline for the whole body: a timeout per recv would let a client that
        # trickles a byte now and then hold this thread for as long as it likes.
        deadline = time.monotonic() + REFUSED_BODY_DISCARD_TIMEOUT_SECONDS
        remaining = length
        try:
            while remaining > 0:
                rest = deadline - time.monotonic()
                if rest <= 0:
                    return
                self.connection.settimeout(rest)
                chunk = self.rfile.read1(remaining)
                if not chunk:
                    return
                remaining -= len(chunk)
        except OSError:
            pass

    def end_headers(self) -> None:
        try:
            # Every HTML answer carries the policy, whichever path wrote it: the client,
            # the backup callback page, an error page. Not static assets or JSON (T-61).
            policy = getattr(self.application, "content_security_policy", None)
            if policy is not None and is_html(getattr(self, "_content_type", "")):
                self.send_header(*policy)
            # Any Set-Cookie headers queued by the auth routes ride along on whatever
            # response actually gets sent (send_json/send_pdf/redirect/static fallback).
            for key, value in getattr(self, "_pending_cookies", None) or []:
                self.send_header(key, value)
            # On every answer, whichever path wrote it, so the id a user reports can
            # always be found in the log -- even for a redirect or a static file.
            request = log_schema.current_request.get()
            if request is not None and self._response_status >= 200:
                self.send_header(REQUEST_ID_HEADER, request.request_id)
            # A 100 Continue is its own header block and send_response_only() does not
            # set _response_status. Do not advertise a close until the final response.
            if (
                self.close_connection
                and self._response_status >= 200
                and not getattr(self, "_sent_connection_header", False)
            ):
                self.send_header("Connection", "close")
            super().end_headers()
        finally:
            self._sent_connection_header = False

    def log_message(self, format, *args):
        pass  # Suppress default noise; meaningful operations are logged explicitly.

    # ---------- Auth helpers ----------

    def get_cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(raw)
        except Exception:  # noqa: BLE001 - an unreadable cookie header means "no cookie"
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
        # The client names its interface language so the provider's pages -- and
        # the mails of an account registered there -- use it. Only the languages
        # the realm offers pass; anything else is dropped, never forwarded.
        requested = (parse_qs(urlparse(self.path).query).get("ui_locales") or [""])[0]
        ui_locale = requested.strip().lower()
        authorize_url, state = self.application.identity.auth.start_login(
            redirect_uri, ui_locales=ui_locale if ui_locale in LOGIN_UI_LOCALES else None
        )
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
        except Exception as exc:  # noqa: BLE001 - any token exchange failure is logged and redirects with an error
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
            session = self.application.identity.auth.store_session_tokens(
                session.session_id,
                tokens,
                verified_id_token=str(tokens["id_token"]),
                verified_claims=claims,
            )
        if session is not None and not session.roles:
            # Roles come only from the flat `roles` claim of the ID token. Without
            # it every account looks unentitled, so say so once per login. The fix
            # is to assign the client scope `quiltor-roles` to the client;
            # roles_claim_present tells that case apart from an account that
            # simply has no roles.
            self.application.observability.logger.event(
                "warning",
                "identity.login_without_roles",
                sub=session.sub,
                roles_claim_present="roles" in claims,
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

    def log_rejection(self, event: str, **fields: Any) -> None:
        """A route's refusal, as a WARNING line in the current request's context."""
        self.application.observability.logger.event("warning", event, **fields)

    def _resolve_world_or_respond(self, session, world_id: str) -> WebWorldContext | None:
        reason: str
        try:
            world = self.application.resolve_world(session, world_id)
        except ValueError as exc:
            reason = "invalid"
            self.send_exception(exc)
        except PermissionError as exc:
            reason = "forbidden"
            self.send_exception(exc)
        except FileNotFoundError as exc:
            reason = "not_found"
            self.send_exception(exc)
        else:
            # Only now is this the world the request acts on; a world the query or the
            # body merely names never reaches the context.
            request = log_schema.current_request.get()
            if request is not None:
                request.world_id = world_id
            return world
        valid = log_schema.FIELD_RULES["world_id"](world_id) is not None
        self.log_rejection(
            "world.resolve_failed",
            reason=reason,
            world_id=world_id if valid else None,
            world_id_invalid=None if valid else True,
        )
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
        self._error_code = None
        self._bytes_out = 0
        self._request_body_read = False
        requested_path = self.path.split("?", 1)[0]
        # From the registry or a fixed bucket, never from the path itself: a path is
        # whatever the client sent.
        route = (
            requested_path
            if requested_path in table
            else ("unmatched_api" if requested_path.startswith("/api/") else "client_asset")
        )
        request_id, request_id_rejected = log_schema.accept_request_id(
            self.headers.get(REQUEST_ID_HEADER)
        )
        context = log_schema.RequestContext(
            request_id=request_id,
            method=log_schema.method_bucket(self.command),
            route=route,
        )
        logger = self.application.observability.logger
        with log_schema.request_scope(context):
            try:
                self._dispatch_request(table, on_miss=on_miss)
            except Exception as exc:
                if not self._request_body_read:
                    # A handler that raises before reading (an invalid upload type, a
                    # conflict, a crash) leaves the body in the socket like a plain
                    # refusal does; drained before the 4xx or 500 below goes out.
                    self._discard_unread_body()
                self.application.observability.metrics.increment(
                    "http_requests_total",
                    method=self.command,
                    route=route,
                    outcome="failure",
                    error_type=type(exc).__name__,
                )
                fields: dict[str, Any] = {
                    "method": context.method,
                    "route": route,
                    "status": self._response_status or None,
                    "error_type": type(exc).__name__,
                    "message": _exception_text(exc) or None,
                    "traceback": _safe_traceback(exc),
                }
                if isinstance(exc, RequestBodyRejected):
                    fields["reason"] = exc.reason
                    fields["transfer_encoding_present"] = (
                        self.headers.get("Transfer-Encoding") is not None
                    )
                if (
                    isinstance(exc, ApplicationError)
                    and not self._response_status
                    and http_errors.from_exception(exc).status < 500
                ):
                    # An expected refusal (a conflict, a missing or foreign resource):
                    # http.error carries its code, and it is no server failure. A 5xx
                    # application error wraps a failure and keeps its traceback.
                    self.send_exception(exc)
                    return
                logger.event("error", "http.unhandled", **fields)
                if self._response_status:
                    # Logged here, with the request's id; Server.handle_error must not
                    # write the same failure a second time without it.
                    setattr(exc, _LOGGED_ATTR, True)
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
                elapsed = time.monotonic() - started
                self.application.observability.metrics.observe(
                    "http_request_duration_seconds",
                    elapsed,
                    method=self.command,
                    route=route,
                )
                self._log_request(context, requested_path, elapsed, request_id_rejected)

    def _log_request(
        self,
        context: log_schema.RequestContext,
        requested_path: str,
        elapsed: float,
        request_id_rejected: bool,
    ) -> None:
        logger = self.application.observability.logger
        status = self._response_status
        who = {"sub": context.sub, "world_id": context.world_id}
        if status >= 400 and (requested_path.startswith("/api/") or self._error_code):
            logger.event(
                "error" if status >= 500 else "warning",
                "http.error",
                method=context.method,
                route=context.route,
                status=status,
                code=self._error_code,
                **who,
            )
        try:
            bytes_in = max(0, int((self.headers.get("Content-Length") or "0").strip()))
        except ValueError:
            bytes_in = 0
        quiet = context.route == "client_asset" or context.route in log_schema.QUIET_ROUTES
        logger.event(
            "debug" if quiet else "info",
            "http.access",
            method=context.method,
            route=context.route,
            status=status,
            duration_ms=round(elapsed * 1000),
            bytes_in=bytes_in,
            bytes_out=self._bytes_out,
            request_id_rejected=True if request_id_rejected else None,
            **who,
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
        _note_session(session)
        redirect = getattr(self, identity.REDIRECT_ATTR, None)
        if redirect is not None:
            # A secret came in through the query string. The cookie above is
            # already queued and rides along on the 302 (end_headers sends
            # _pending_cookies), so the bounced request arrives logged in.
            self._discard_unread_body()
            return self.send_redirect(redirect)
        if session is None and not (registration and registration.anonymous):
            # Every answer below is given without a route reading the body.
            self._discard_unread_body()
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
            self._discard_unread_body()
            return on_miss()

        if registration.operator_only and not self.application.installable:
            # Several people share a hosted server; what it runs is installed by its
            # operator (D-59). Refused before the world and before any body is read.
            self._discard_unread_body()
            # `path` is a key of the route table here, never the raw request URL.
            self.log_rejection("install.forbidden_hosted", route=path)
            return self.send_api_error(403, error_code="install.forbidden_hosted", retryable=False)

        if registration.device_sync and not self.application.syncable:
            # A hosted server is the shared storage for everyone on it, so syncing
            # with another device has no place there (D-61). Same form as above.
            self._discard_unread_body()
            self.log_rejection("sync.forbidden_hosted", route=path)
            return self.send_api_error(403, error_code="sync.forbidden_hosted", retryable=False)

        request = api_routes.Request(path=path, query=query, session=session)
        if registration.world:
            # Resolved before the route runs, so a refusal here leaves the body unread.
            # The discard comes after the answer: it is the close that resets, and the
            # world has to be looked up before anyone knows there will be a refusal.
            request.world = self._resolve_world_or_respond(session, (query.get("world") or [""])[0])
            if request.world is None:
                self._discard_unread_body()
                return
        registration.handler(self, request, self.application.route_services(path))
        if not self._request_body_read:
            # A route may refuse without reading the body (POST /api/backup/login in
            # multi-user mode answers 409 straight away). The connection closes after
            # every request with a body, so the same reset as above applies.
            self._discard_unread_body()

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

    # How many connections may wait before the operating system refuses the next one.
    #
    # socketserver defaults to five. A single page opens more than that: the sheet, its
    # fonts, a map's images and the API calls beside them all go out at once, and the
    # accepting thread falls behind for a moment. Linux then drops the SYN and the browser
    # retries; Windows refuses actively, and the caller sees "connection refused" from a
    # server that is running and still logging. That is exactly what happened in CI --
    # four tests, a dead port, and a server with nothing wrong with it.
    request_queue_size = 128

    def __init__(self, server_address, handler_class, application: WebApplication):
        self.application = application
        super().__init__(server_address, handler_class)

    def handle_error(self, request, client_address) -> None:
        """Do not report a browser that walked away as a server error.

        Closing a tab while an image loads aborts the connection. socketserver writes a
        full traceback for that into the log -- the same log somebody later searches for a
        real failure. Everything else stays visible.
        """

        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        if exc is None or getattr(exc, _LOGGED_ATTR, False):
            return
        # A structured line instead of socketserver's plain traceback, which would
        # print the exception's own text -- see _exception_text.
        self.application.observability.logger.event(
            "error",
            "http.unhandled",
            error_type=type(exc).__name__,
            message=_exception_text(exc) or None,
            traceback=_safe_traceback(exc),
        )


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
    print(f"  Quiltor · Writing workspace · v{app.version}")
    print("  " + "─" * 52)
    print(f"  Address    {url}")
    # The worlds directory, not a single database file: there is no process-wide
    # open world any more, so "the" database is not a thing this process has.
    print(f"  Worlds      {app.application.worlds.worlds_directory}")
    print(f"  Backups     {app.backups_directory}")
    # Always printed: there is always an identity, and which one is in force is
    # the single most useful thing to know about a running instance. Never the
    # token -- a secret on a terminal is a secret in a scrollback buffer.
    if app.identity.multi_user:
        print(f"  Identity    Keycloak ({app.identity.auth.issuer})")
    else:
        print("  Identity    local (one user)")
    if print_token:
        # Only ever on request (--print-token), and only for this process: the
        # token dies with it, so a copied line is not a lasting credential.
        token = getattr(app.identity, "token", "")
        print(
            f"  Token       {token}"
            if token
            else "  Token       — this instance has no local identity"
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
        print(f"  ! Port {port} is unavailable ({exc}).")
        print(f"  ! Try:  python3 apps/web/server.py {port + 1}")
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
