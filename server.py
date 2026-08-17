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
    python3 server.py                 # port 8000, opens the browser
    python3 server.py 8080            # custom port
    python3 server.py 8080 --no-open  # do not open a browser

Stop: Ctrl+C

Standard library only. No installation required. On first run, if no local
AI assistant is set up yet, you'll be asked once whether to download one
(llama.cpp + a GGUF model, or MLX on Apple Silicon) — answer no and Quiltor
runs exactly the same, just without the assistant panel.

Every request has a session, in both shapes Quiltor runs in; what differs is
only who the users are. Setting QUILTOR_OIDC_ISSUER installs the OIDC identity:
Keycloak login, accounts, per-user world isolation — see README for the required
env vars. With it unset (the default), the local identity is installed instead:
one user, the person at this machine, recognised by a loopback connection, a
`?token=` link or a Bearer token, and no login page at all. Which one is
installed is the module global IDENTITY; backend/identity.py holds both.
"""

import http.cookies
import http.server
import json
import os
import socketserver
import sys
import threading
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from backend.system import force_utf8_streams

force_utf8_streams()

from backend import auth, identity
from backend.api import routes as api_routes
from backend.core import storage
from backend.assistant import AssistantRuntime
from backend.core.backup import BackupContext, SnapshotStore
from backend.core.backup import remote as backup_remote
from backend.core.validation import valid_figures, valid_manuscript
from backend.identity import SESSION_COOKIE
from backend.language import LanguageService
from backend.llm.installer import ensure_installed
# issue_render_token is unused here but reached as `app.issue_render_token` from
# backend/api/routes/documents.py, which is how routes see the server module.
# redeem_render_token is now called by backend/identity.py; it stays re-exported
# because the render-token tests drive it through the server module.
from backend.pdf import issue_render_token, redeem_render_token, server_renderer  # noqa: F401

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "dist"
VERSION_FILE = BASE / "VERSION"
VERSION = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "dev"
DATA = storage.DATA
BACKUPS = DATA / "backups"
WORLD_BACKUPS = SnapshotStore(DATA / "history")
ensure_installed()
# Where the assistant looks for its runtime/model (backend/llm/installer.py's
# HOME): BASE for a source checkout / Docker, or QUILTOR_HOME for the packaged
# CLI. Deliberately not BASE itself -- that stays the package root for
# PUBLIC/VERSION_FILE/render script above, none of which move with QUILTOR_HOME.
RUNTIME_HOME = Path(os.environ.get("QUILTOR_HOME", str(BASE)))
ASSISTANT = AssistantRuntime(RUNTIME_HOME, DATA)
LANGUAGE = LanguageService(DATA)

MAX_BODY = 16 * 1024 * 1024 # 16 MB limit per save request

_lock = threading.Lock()

# ------------------------------------------------- Local-mode request guard
#
# This is CSRF defence, not authentication -- the two are separate jobs and this
# one is not made redundant by the other. Every request now resolves to a
# session (see IDENTITY below), and locally that session is handed out to
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
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
BOUND_TO_LOOPBACK = os.environ.get("QUILTOR_HOST", "127.0.0.1") in LOOPBACK_HOSTS


def authority_host(authority: str) -> str:
    """Hostname out of a `name:port` authority, IPv6 brackets stripped."""
    if authority.startswith("["):
        closing = authority.find("]")
        return authority[1:closing] if closing > 0 else authority
    return authority.rsplit(":", 1)[0] if ":" in authority else authority

# ---------------------------------------------------------------- Identity

#: Who the users of this process are. Chosen once at import, from the one thing
#: that actually differs between the deployments; everything else asks the
#: object rather than re-deriving the mode. backend/identity.py documents both.
IDENTITY = identity.OidcIdentity() if auth.OIDC_ENABLED else identity.LocalIdentity()

PUBLIC_URL = os.environ.get("QUILTOR_PUBLIC_URL", "").rstrip("/")
# SESSION_COOKIE is imported from backend/identity.py, which owns it: the
# identity is what writes and reads that cookie. Re-exported here because the
# routes reach it as `app.SESSION_COOKIE`.
LOGIN_STATE_COOKIE = "quiltor_login_state"


@dataclass
class WorldContext:
    """Per-request paths for one user's world — resolved fresh each call, never stored."""

    id: str
    db_path: Path
    backups_dir: Path
    manuscripts_dir: Path
    profiles_dir: Path
    backup: BackupContext  # always present -- a world without an endpoint still gets local history


def resolve_world(session: "auth.SessionData", world_id: str) -> WorldContext:
    """Resolve a per-request world context for the session's own world, or raise.

    The single way to a world's data, in every deployment: there is no
    process-wide "active world" any more, so every request that touches a
    document names the world it means and gets its paths from here.

    ValueError -> malformed id, PermissionError -> owned by someone else,
    FileNotFoundError -> no such world. Callers map these to 400/403/404.
    """
    if not storage.WORLD_ID_RE.fullmatch(world_id or ""):
        raise ValueError("Invalid world id.")
    owner = storage.get_world_owner(world_id)
    if owner is None:
        raise FileNotFoundError("This world does not exist.")
    if owner != session.sub:
        raise PermissionError("This world belongs to a different account.")
    db_path = storage.world_db_path(world_id)
    storage.initialize(db_path)
    # storage.DATA, not the server module's own DATA constant: that one is frozen
    # at import time and won't follow a reassigned storage.DATA (as tests do, and
    # as QUILTOR_DATA_DIR does before the very first import).
    #
    # Every world's Markdown mirrors live under its own id, local instances
    # included -- they used to be written flat into data/manuscripts/ when there
    # was one active world per process. Nothing migrates the old flat files: they
    # are derived from SQLite and the next save writes them again in the new
    # place. The stale copies are harmless and can simply be deleted.
    manuscripts_dir = storage.DATA / "manuscripts" / world_id
    profiles_dir = storage.DATA / "profiles" / world_id
    manuscripts_dir.mkdir(parents=True, exist_ok=True)
    profiles_dir.mkdir(parents=True, exist_ok=True)
    backups_dir = storage.DATA / "backups" / world_id
    world = next((w for w in storage.list_worlds(owner_sub=session.sub) if w["id"] == world_id), None)
    endpoint_url = (world or {}).get("backupUrl", "")
    # Every world gets a local backup history, even without a configured remote --
    # only uploading needs one; an unset endpoint just means history stays local.
    backup_ctx = WORLD_BACKUPS.context(world_id, endpoint_url, db_path, manuscripts_dir, profiles_dir, title=(world or {}).get("title", ""))
    return WorldContext(id=world_id, db_path=db_path, backups_dir=backups_dir,
                         manuscripts_dir=manuscripts_dir, profiles_dir=profiles_dir, backup=backup_ctx)


def restore_world_from_endpoint(session: "auth.SessionData", world_id: str, snapshot_id: str, endpoint: str) -> dict[str, Any]:
    """Pull one snapshot back from the backup endpoint and write it over the world.

    Restores the SQLite database above all: it is the authoritative store, and the
    Markdown mirrors are derived from it (they get rewritten on the next save).
    Callers hold _lock.
    """
    db_path = storage.world_db_path(world_id)
    manuscripts_dir = storage.DATA / "manuscripts" / world_id
    profiles_dir = storage.DATA / "profiles" / world_id
    ctx = WORLD_BACKUPS.context(world_id, endpoint, db_path, manuscripts_dir, profiles_dir)

    if db_path.exists():
        # The overwrite must itself be undoable: snapshot whatever is there now,
        # locally, before replacing it. Nothing is uploaded -- this is a safety
        # net on this machine, not a new state worth publishing.
        WORLD_BACKUPS.commit(ctx, "Before restore", push=False)

    available = backup_remote.snapshots(ctx)
    if not available:
        raise ValueError("The endpoint holds no snapshots for this world.")
    entry = next((s for s in reversed(available) if s["id"] == snapshot_id or s["id"].startswith(snapshot_id)), None) if snapshot_id else available[-1]
    if entry is None:
        raise ValueError("No such snapshot at the endpoint.")

    result = WORLD_BACKUPS.restore(ctx, entry, fetch=lambda digest: backup_remote.fetch_blob(ctx, digest))
    storage.initialize(db_path)
    # The restored database carries the owner it had when it was backed up.
    # Whoever restores it is the owner now, or they would be locked out of the
    # world they just pulled down. Locally that writes storage.LOCAL_OWNER --
    # exactly the owner every local world already carries.
    with storage.connect(db_path) as conn:
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)", (session.sub,))
    print(f"  · {datetime.now():%H:%M:%S}  restored world {world_id} from snapshot {entry['id'][:8]}")
    return {"ok": True, **result, "title": entry.get("title", ""), "created": entry.get("created", "")}


# ---------------------------------------------------------------- Storage

def ensure_dirs() -> None:
    # parents=True: DATA's parent is QUILTOR_HOME for a pip/pipx install, which
    # (unlike the package root a source checkout/Docker uses) may not exist yet.
    # DATA/BACKUPS only: the manuscript and profile mirrors live per world now and
    # resolve_world() creates each world's pair (with its parents) on first use.
    for d in (DATA, BACKUPS):
        d.mkdir(parents=True, exist_ok=True)
    # storage.DB is the .no-active-world sentinel, and the HTTP layer never reads
    # it -- every request names its world. It stays schema'd for the callers that
    # have no session and no request at all: the MCP server and the seed scripts
    # still switch the process-global database, and any read before they do lands
    # here. Any database Quiltor connects to has the schema; "no world yet" then
    # simply reads as empty instead of raising "no such table".
    storage.initialize()


# ------------------------------------------------------------------ Server

# The validator for each of the two document routes. Just the validator: where
# the Markdown mirror is written follows from the request's world, so it is no
# longer something the table can carry.
ROUTES = {
    "/api/state":      valid_figures,
    "/api/manuscript": valid_manuscript,
}


# The Node/Playwright-JS subprocess path, which is what Docker and `npm run dev`
# want. desktop.py replaces this with backend.pdf.desktop_renderer() -- a windowed
# app has no Node, and which renderer it may use is an edition decision. Keeping
# it a module global is how the host tells the core, and stays the seam until
# hosts/ exists.
RENDER_PDF = server_renderer(BASE / "scripts" / "render-book-pdf.mjs", BASE)

# Populates api_routes.GET / api_routes.SAVE. At import time rather than on the
# first request, so a broken route module fails at startup instead of as a 404.
api_routes.load()


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        # Only the built Vite client is public; databases and mirrors stay private.
        # Never fall back to BASE: that would serve data/worlds/*.sqlite3, backups,
        # and source alongside the app. If dist/ is missing, static GETs just 404.
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def send_json(self, obj, code: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

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
        if not BOUND_TO_LOOPBACK:
            return False

        host = authority_host(self.headers.get("Host", ""))
        if host and host not in LOOPBACK_HOSTS:
            self.send_json({"ok": False, "fehler": "unerlaubter Host"}, 403)
            return True

        origin = (self.headers.get("Origin") or "").strip()
        # "null" is what a sandboxed iframe or a file:// page sends; it is never
        # us, so it gets refused alongside any other foreign origin.
        if origin and (origin == "null"
                       or authority_host(urlparse(origin).netloc) not in LOOPBACK_HOSTS):
            self.send_json({"ok": False, "fehler": "unerlaubte Herkunft"}, 403)
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

        A handler method purely so backend/identity.py can ask: backend/ must
        stay importable from the CLI and the MCP server, which start no HTTP
        server, so it may not import this module (backend/api/__init__.py,
        pinned by tests/backend/test_hosts.py). The handler is the one object
        both sides already share, so it carries the answer across.
        """
        return BOUND_TO_LOOPBACK

    def cookie_secure(self) -> bool:
        override = os.environ.get("QUILTOR_COOKIE_SECURE", "auto")
        if override == "1":
            return True
        if override == "0":
            return False
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

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
        if PUBLIC_URL:
            return PUBLIC_URL
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
        authorize_url, state = auth.start_login(redirect_uri)
        self._pending_cookies.append(self.cookie_header(LOGIN_STATE_COOKIE, state, max_age=600))
        return self.send_redirect(authorize_url)

    def handle_auth_callback(self) -> None:
        q = parse_qs(urlparse(self.path).query)
        if (q.get("error") or [""])[0]:
            return self.send_redirect("/login?failed=1")
        code = (q.get("code") or [""])[0]
        state = (q.get("state") or [""])[0]
        cookie_state = self.get_cookie(LOGIN_STATE_COOKIE)
        if not code or not state or not cookie_state or state != cookie_state:
            return self.send_json({"ok": False, "fehler": "Invalid login state."}, 400)
        pending = auth.consume_pending_login(state)
        if pending is None:
            return self.send_json({"ok": False, "fehler": "Login expired or already used."}, 400)
        try:
            tokens = auth.exchange_code(code, pending["verifier"], pending["redirect_uri"])
            claims = auth.decode_id_token_claims(tokens["id_token"])
            auth.validate_claims(claims)
        except Exception as exc:
            return self.send_json({"ok": False, "fehler": f"Login failed: {exc}"}, 400)
        session_id = auth.create_session(str(claims.get("sub", "")), str(claims.get("email", "")),
                                          str(claims.get("name") or claims.get("preferred_username") or ""))
        self._pending_cookies.append(self.cookie_header(SESSION_COOKIE, session_id, max_age=auth.SESSION_TTL))
        self._pending_cookies.append(self.cookie_header(LOGIN_STATE_COOKIE, "", max_age=0))
        return self.send_redirect("/")

    def handle_logout(self) -> None:
        auth.destroy_session(self.get_cookie(SESSION_COOKIE))
        self._pending_cookies.append(self.cookie_header(SESSION_COOKIE, "", max_age=0))
        return self.send_json({"ok": True})

    def _resolve_world_or_respond(self, session, world_id: str) -> WorldContext | None:
        try:
            return resolve_world(session, world_id)
        except ValueError as exc:
            self.send_json({"ok": False, "fehler": str(exc)}, 400)
        except PermissionError as exc:
            self.send_json({"ok": False, "fehler": str(exc)}, 403)
        except FileNotFoundError as exc:
            self.send_json({"ok": False, "fehler": str(exc)}, 404)
        return None

    def world_from_body(self, session, payload) -> "WorldContext | None":
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
    # The routes themselves live in backend/api/routes/, grouped by subject.
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
        if registration is not None and registration.auth_only and not IDENTITY.multi_user:
            registration = None  # nothing to choose between when there is one user

        # _pending_cookies must already exist here: resolving queues the session
        # cookie onto this very response.
        session = IDENTITY.resolve(self)
        redirect = getattr(self, identity.REDIRECT_ATTR, None)
        if redirect is not None:
            # A secret came in through the query string. The cookie above is
            # already queued and rides along on the 302 (end_headers sends
            # _pending_cookies), so the bounced request arrives logged in.
            return self.send_redirect(redirect)
        if session is None and not (registration and registration.anonymous):
            if path.startswith("/api/"):
                return self.send_json({"ok": False, "fehler": "not authenticated"}, 401)
            if IDENTITY.login_url:
                return self.send_redirect(IDENTITY.login_url)
            # No login page to send anyone to: the request simply is not this
            # machine's owner, and there is nothing they could do about it here.
            return self.send_json({"ok": False, "fehler": "not authenticated"}, 403)

        if registration is None:
            return on_miss()

        request = api_routes.Request(path=path, query=query, session=session)
        if registration.world:
            request.world = self._resolve_world_or_respond(session, (query.get("world") or [""])[0])
            if request.world is None:
                return
        registration.handler(self, request, sys.modules[__name__])

    def do_GET(self):
        self._dispatch(api_routes.GET, on_miss=self.serve_client)

    def _save(self):
        self._dispatch(api_routes.SAVE, on_miss=lambda: self.send_error(404))

    do_PUT = _save
    do_POST = _save


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def run(port: int = 8000, no_open: bool = False, print_token: bool = False) -> None:
    ensure_dirs()
    url = f"http://localhost:{port}/"

    print()
    print(f"  Quiltor · Autorenwerkstatt · v{VERSION}")
    print("  " + "─" * 52)
    print(f"  Adresse    {url}")
    # The worlds directory, not a single database file: there is no process-wide
    # open world any more, so "the" database is not a thing this process has.
    print(f"  Welten      {storage.WORLDS}")
    print(f"  Backups     {BACKUPS}")
    # Always printed: there is always an identity, and which one is in force is
    # the single most useful thing to know about a running instance. Never the
    # token -- a secret on a terminal is a secret in a scrollback buffer.
    if IDENTITY.multi_user:
        print(f"  Identity    Keycloak ({auth.ISSUER})")
    else:
        print("  Identity    lokal (ein Nutzer)")
    if print_token:
        # Only ever on request (--print-token), and only for this process: the
        # token dies with it, so a copied line is not a lasting credential.
        token = getattr(IDENTITY, "token", "")
        print(f"  Token       {token}" if token else
              "  Token       — diese Instanz hat keine lokale Identität")
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
        with Server((os.environ.get("QUILTOR_HOST", "127.0.0.1"), port), Handler) as httpd:
            httpd.serve_forever()
    except OSError as exc:
        print(f"  ! Port {port} ist belegt ({exc}).")
        print(f"  ! Versuch es mit:  python3 server.py {port + 1}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Stopped. Your work is stored in data/\n")
    finally:
        ASSISTANT.close()
        LANGUAGE.close()


def main() -> None:
    argv = sys.argv[1:]
    no_open = "--no-open" in argv
    # The only way the local token is ever shown, and it prints *this* process's
    # secret at startup rather than in a separate run: the token is generated
    # per process, so one printed by any other invocation would be worthless.
    # Without the flag it appears nowhere -- not in the banner, not in a log.
    print_token = "--print-token" in argv
    positional = [a for a in argv if not a.startswith("--")]
    port = int(positional[0]) if positional else 8000
    run(port=port, no_open=no_open, print_token=print_token)


if __name__ == "__main__":
    main()
