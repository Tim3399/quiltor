#!/usr/bin/env python3
"""
Quiltor — small local writing server

Two workspaces at one address; SQLite is the authoritative store:
  · Worlds                            → data/worlds/*.sqlite3
  · Characters  Relationship graph and profiles in SQLite
                readable profiles   → data/profiles/NN - Name.md
  · Text        Manuscript in SQLite
  · Backup      Snapshot and upload from the UI
  · History     Human-readable changes
                                     → data/manuscripts/NN - Title.md

Starten:
    python3 server.py                 # port 8000, opens the browser
    python3 server.py 8080            # custom port
    python3 server.py 8080 --no-open  # do not open a browser

Stop: Ctrl+C

Standard library only. No installation required. On first run, if no local
AI assistant is set up yet, you'll be asked once whether to download one
(llama.cpp + a GGUF model, or MLX on Apple Silicon) — answer no and Quiltor
runs exactly the same, just without the assistant panel.

Setting QUILTOR_OIDC_ISSUER switches on Keycloak login and per-user world
isolation for a hosted web demo — see README for the required env vars. With
it unset (the default), Quiltor behaves exactly like the local single-user
tool described above.
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

from backend import auth, storage
from backend.assistant import ASSISTANT_REPLY_LANGUAGES, DEFAULT_ASSISTANT_LANGUAGE, AssistantRuntime, read_progress
from backend.backup import BackupContext, SnapshotStore
from backend.backup import remote as backup_remote
from backend.knowledge import build_knowledge
from backend.llm.installer import ensure_installed, install_async, is_configured, read_install_state
from backend.mirror import mirror_profiles, mirror_text, safe_name
from backend.pdf import RENDER_TOKEN_TTL, issue_render_token, redeem_render_token, server_renderer
from backend.validation import valid_figures, valid_manuscript
from backend.language import LanguageService

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "dist"
VERSION_FILE = BASE / "VERSION"
VERSION = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "dev"
DATA = storage.DATA
BACKUPS = DATA / "backups"
MANUSCRIPT_DIR = DATA / "manuscripts"
PROFILE_DIR = DATA / "profiles"
WORLD_BACKUPS = SnapshotStore(DATA / "history")
# The single "currently open" world's Git backup context (local single-user mode
# mirrors storage.DB/ACTIVE_WORLD_ID: one process, one active world at a time).
CURRENT_GIT: BackupContext | None = None
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
# The local build has no authentication at all (AUTH_ENABLED stays false
# without QUILTOR_OIDC_ISSUER), and loopback is not a security boundary in a
# browser: any page the user happens to visit can send us a cross-origin
# request. A plain
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

# ------------------------------------------------------------- Auth (OIDC)

AUTH_ENABLED = auth.OIDC_ENABLED
PUBLIC_URL = os.environ.get("QUILTOR_PUBLIC_URL", "").rstrip("/")
SESSION_COOKIE = "quiltor_session"
LOGIN_STATE_COOKIE = "quiltor_login_state"


@dataclass
class WorldContext:
    """Per-request paths for one user's world — resolved fresh each call, never stored."""

    id: str
    db_path: Path
    backups_dir: Path
    manuscripts_dir: Path
    profiles_dir: Path
    git: BackupContext  # always present -- a world without an endpoint still gets local history


def resolve_world(session: "auth.SessionData", world_id: str) -> WorldContext:
    """Resolve a per-request world context for the session's own world, or raise.

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
    # storage.DATA, not the server-module DATA/MANUSCRIPT_DIR/PROFILE_DIR constants:
    # those are frozen at import time and won't follow a reassigned storage.DATA
    # (as tests do, and as QUILTOR_DATA_DIR does before the very first import).
    manuscripts_dir = storage.DATA / "manuscripts" / world_id
    profiles_dir = storage.DATA / "profiles" / world_id
    manuscripts_dir.mkdir(parents=True, exist_ok=True)
    profiles_dir.mkdir(parents=True, exist_ok=True)
    backups_dir = storage.DATA / "backups" / world_id
    world = next((w for w in storage.list_worlds(owner_sub=session.sub) if w["id"] == world_id), None)
    endpoint_url = (world or {}).get("backupUrl", "")
    # Every world gets a local backup history, even without a configured remote --
    # only uploading needs one; an unset endpoint just means history stays local.
    git_ctx = WORLD_BACKUPS.context(world_id, endpoint_url, db_path, manuscripts_dir, profiles_dir, title=(world or {}).get("title", ""))
    return WorldContext(id=world_id, db_path=db_path, backups_dir=backups_dir,
                         manuscripts_dir=manuscripts_dir, profiles_dir=profiles_dir, git=git_ctx)


def restore_world_from_endpoint(session: "auth.SessionData | None", world_id: str, snapshot_id: str, endpoint: str) -> dict[str, Any]:
    """Pull one snapshot back from the backup endpoint and write it over the world.

    Restores the SQLite database above all: it is the authoritative store, and the
    Markdown mirrors are derived from it (they get rewritten on the next save).
    Callers hold _lock.
    """
    db_path = storage.world_db_path(world_id)
    manuscripts_dir = storage.DATA / "manuscripts" / world_id
    profiles_dir = storage.DATA / "profiles" / world_id
    ctx = WORLD_BACKUPS.context(world_id, endpoint, db_path, manuscripts_dir, profiles_dir)

    if world_id == storage.ACTIVE_WORLD_ID:
        raise ValueError("Close this world before restoring it.")
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
    if AUTH_ENABLED and session is not None:
        # The restored database carries the owner it had when it was backed up.
        # Whoever restores it is the owner now, or they would be locked out of
        # the world they just pulled down.
        with storage.connect(db_path) as conn:
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)", (session.sub,))
    print(f"  · {datetime.now():%H:%M:%S}  restored world {world_id} from snapshot {entry['id'][:8]}")
    return {"ok": True, **result, "title": entry.get("title", ""), "created": entry.get("created", "")}


# ---------------------------------------------------------------- Storage

def ensure_dirs() -> None:
    # parents=True: DATA's parent is QUILTOR_HOME for a pip/pipx install, which
    # (unlike the package root a source checkout/Docker uses) may not exist yet.
    for d in (DATA, BACKUPS, MANUSCRIPT_DIR, PROFILE_DIR):
        d.mkdir(parents=True, exist_ok=True)
    # storage.DB starts out as the .no-active-world sentinel and only becomes a real
    # world's file once activate_world() reassigns it. Reads still land there before
    # the first world is opened -- /api/assistant/status polls immediately on load --
    # and an unschema'd file makes those fail with "no such table" rather than
    # returning an empty result. Giving the sentinel the schema upholds the invariant
    # every reader already assumes: any database Quiltor connects to has the schema,
    # and "no world yet" simply reads as empty.
    storage.initialize()


# ------------------------------------------------------------------ Server

ROUTES = {
    "/api/state":      (valid_figures, lambda p: mirror_profiles(p, PROFILE_DIR)),
    "/api/manuscript": (valid_manuscript, lambda p: mirror_text(p["chapters"], MANUSCRIPT_DIR)),
}


# The Node/Playwright-JS subprocess path, which is what Docker and `npm run dev`
# want. desktop.py replaces this with backend.pdf.desktop_renderer() -- a windowed
# app has no Node, and which renderer it may use is an edition decision. Keeping
# it a module global is how the host tells the core, and stays the seam until
# hosts/ exists.
RENDER_PDF = server_renderer(BASE / "scripts" / "render-book-pdf.mjs", BASE)


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

    # ---------- Routes ----------

    def do_GET(self):
        self._pending_cookies = []
        if self.reject_foreign_request():
            return
        route = self.path.split("?")[0]
        query = parse_qs(urlparse(self.path).query)
        world_id = (query.get("world") or [""])[0]

        if route == "/api/version":
            return self.send_json({"ok": True, "version": VERSION})

        session = auth.get_session(self.get_cookie(SESSION_COOKIE)) if AUTH_ENABLED else None
        if AUTH_ENABLED and session is None:
            token = (query.get("renderToken") or [""])[0]
            if token:
                sub = redeem_render_token(token)
                if sub:
                    # Scoped to the render itself, not a normal 24h login: this cookie
                    # only exists so the headless render subprocess can act as the
                    # requesting user for the one page load it needs.
                    new_session_id = auth.create_session(sub, "", "", ttl=RENDER_TOKEN_TTL)
                    session = auth.get_session(new_session_id)
                    self._pending_cookies.append(self.cookie_header(SESSION_COOKIE, new_session_id, max_age=RENDER_TOKEN_TTL))

        if AUTH_ENABLED and route not in ("/login", "/auth/callback", "/api/whoami") and session is None:
            if route.startswith("/api/"):
                return self.send_json({"ok": False, "fehler": "not authenticated"}, 401)
            return self.send_redirect("/login")

        if AUTH_ENABLED and route == "/login":
            return self.handle_login()
        if AUTH_ENABLED and route == "/auth/callback":
            return self.handle_auth_callback()
        if AUTH_ENABLED and route == "/api/whoami":
            if session is None:
                return self.send_json({"ok": False})
            return self.send_json({"ok": True, "sub": session.sub, "email": session.email, "name": session.name})

        if route == "/api/worlds":
            with _lock:
                worlds = storage.list_worlds(owner_sub=session.sub if AUTH_ENABLED else None)
                return self.send_json({"ok": True, "worlds": worlds})

        if route == "/api/language/status":
            return self.send_json({"ok": True, **LANGUAGE.status()})

        world_ctx = None
        if AUTH_ENABLED and route in ("/api/backup", "/api/log", "/api/backups", "/api/assistant/status",
                                       "/api/assistant/logs", "/api/diff", "/api/textfassung",
                                       "/api/state", "/api/manuscript"):
            world_ctx = self._resolve_world_or_respond(session, world_id)
            if world_ctx is None:
                return
        db_path = world_ctx.db_path if world_ctx else None
        git_ctx = world_ctx.git if world_ctx else CURRENT_GIT

        if route == "/api/backup":
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No world is open."})
                return self.send_json(WORLD_BACKUPS.status(git_ctx))

        if route == "/api/backup/remote":
            # Deliberately not world-scoped: this is what a fresh install calls
            # before it has any world at all, to find out what can be restored.
            endpoint = backup_remote.default_endpoint()
            if not endpoint:
                return self.send_json({"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."})
            try:
                return self.send_json({"ok": True, "endpoint": endpoint, "worlds": backup_remote.worlds(endpoint)})
            except Exception as exc:
                return self.send_json({"ok": False, "grund": str(exc)})

        if route == "/api/log":
            with _lock:
                commits = WORLD_BACKUPS.history(git_ctx) if git_ctx else []
                return self.send_json({"ok": True, "commits": commits})

        if route == "/api/backups":
            with _lock:
                backups_dir = world_ctx.backups_dir if world_ctx else None
                return self.send_json({"ok": True, "backups": storage.list_backups(backups_dir)})

        if route == "/api/assistant/status":
            with _lock:
                manuscript, figures = storage.load_manuscript(db_path), storage.load_figures(db_path)
            # Cheap no-op when already running -- picks up a runtime that finished
            # installing since the process started (or since the last poll) without
            # needing a full server restart.
            ASSISTANT.reload()
            return self.send_json({"ok": True, **ASSISTANT.status(), "installed": is_configured(), "chunks": len(build_knowledge(manuscript, figures))})

        if route == "/api/assistant/logs":
            with _lock:
                return self.send_json({"ok": True, "interactions": storage.list_assistant_interactions(db_path=db_path)})

        if route == "/api/assistant/progress":
            progress_id = (query.get("id") or [""])[0]
            # No _lock: this reads the in-memory progress registry (backend/assistant.py),
            # not SQLite/manuscript state, so it's safe to poll while a batch run is in
            # flight on another thread without contending with normal saves.
            progress = read_progress(progress_id) if progress_id else None
            return self.send_json({"ok": progress is not None, "progress": progress})

        if route == "/api/assistant/install/status":
            # No _lock: reads backend/llm/installer.py's own in-memory progress
            # registry, not SQLite/manuscript state -- safe to poll mid-download.
            return self.send_json({"ok": True, **read_install_state()})

        if route == "/api/diff":
            ref = (query.get("ref") or ["WORK"])[0]
            nur_text = (query.get("alles") or ["0"])[0] != "1"
            wortweise = (query.get("modus") or ["wort"])[0] == "wort"
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No world is open."})
                return self.send_json(WORLD_BACKUPS.diff(git_ctx, ref, nur_text, wortweise))

        if route == "/api/textfassung":
            ref = (query.get("ref") or ["WORK"])[0]
            titel = (query.get("titel") or [""])[0]
            kap = (query.get("kapitel") or [""])[0]
            if not kap.isdigit():
                return self.send_json({"ok": False, "grund": "Kapitel fehlt."})
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No world is open."})
                return self.send_json(WORLD_BACKUPS.chapter_version(git_ctx, ref, int(kap), safe_name(titel)))

        if route in ROUTES:
            with _lock:
                kind = "figures" if route == "/api/state" else "manuscript"
                data = storage.load_figures(db_path) if kind == "figures" else storage.load_manuscript(db_path)
                revision = storage.revision(kind, db_path=db_path)
                return self.send_json(data, headers={"ETag": f'"{revision}"'})
        if route == "/":
            self.path = "/index.html"
        return super().do_GET()

    def _save(self):
        self._pending_cookies = []
        if self.reject_foreign_request():
            return
        route = self.path.split("?")[0]
        session = auth.get_session(self.get_cookie(SESSION_COOKIE)) if AUTH_ENABLED else None
        if AUTH_ENABLED and route != "/logout" and session is None:
            return self.send_json({"ok": False, "fehler": "not authenticated"}, 401)

        if AUTH_ENABLED and route == "/logout":
            return self.handle_logout()

        if route in ("/api/worlds/open", "/api/worlds/create", "/api/worlds/delete"):
            global CURRENT_GIT
            try:
                payload = self._read_json_body()
                owner_sub = session.sub if AUTH_ENABLED else None
                with _lock:
                    if route.endswith("/delete"):
                        try:
                            storage.delete_world(str(payload.get("id", "")), owner_sub=owner_sub)
                        except PermissionError as exc:
                            return self.send_json({"ok": False, "fehler": str(exc)}, 403)
                        return self.send_json({"ok": True})

                    if route.endswith("/create"):
                        world = storage.create_world(str(payload.get("title", "")), str(payload.get("backupUrl", "")), owner_sub=owner_sub)
                        if not AUTH_ENABLED:
                            world = storage.activate_world(world["id"])
                    else:
                        world_id = str(payload.get("id", ""))
                        if AUTH_ENABLED:
                            owner = storage.get_world_owner(world_id)
                            if owner is None:
                                return self.send_json({"ok": False, "fehler": "This world does not exist."}, 404)
                            if owner != session.sub:
                                return self.send_json({"ok": False, "fehler": "This world belongs to a different account."}, 403)
                            world = next((w for w in storage.list_worlds(owner_sub=session.sub) if w["id"] == world_id), None)
                            if world is None:
                                return self.send_json({"ok": False, "fehler": "This world does not exist."}, 404)
                        else:
                            world = storage.activate_world(world_id)

                    if not AUTH_ENABLED:
                        # Every world gets a local backup history, even without a
                        # configured endpoint -- history is always local first.
                        CURRENT_GIT = WORLD_BACKUPS.context(world["id"], world.get("backupUrl", ""), storage.DB, MANUSCRIPT_DIR, PROFILE_DIR, title=world.get("title", ""))
                return self.send_json({"ok": True, "world": world})
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)

        if route == "/api/book.pdf":
            port = self.server.server_address[1]
            try:
                try:
                    body_payload = self._read_json_body()
                except Exception:
                    body_payload = {}
                if AUTH_ENABLED:
                    ctx = self._resolve_world_or_respond(session, str(body_payload.get("worldId", "")))
                    if ctx is None:
                        return
                    # The headless render subprocess can't do an interactive Keycloak
                    # login, so it gets a short-lived token that redeems into a real
                    # session cookie on its first request (see redeem_render_token).
                    render_token = issue_render_token(session.sub)
                    target_url = f"http://127.0.0.1:{port}/?world={ctx.id}&renderToken={render_token}"
                else:
                    target_url = f"http://127.0.0.1:{port}/?world={storage.ACTIVE_WORLD_ID}"
                return self.send_pdf(RENDER_PDF(target_url))
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": f"PDF konnte nicht erzeugt werden: {exc}"}, 500)

        if route == "/api/language/install":
            try:
                return self.send_json(LANGUAGE.install())
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 500)

        if route == "/api/language/lookup":
            try:
                request = self._read_json_body()
                return self.send_json(LANGUAGE.lookup(str(request.get("language", "")), str(request.get("mode", "")), str(request.get("query", ""))))
            except FileNotFoundError as exc:
                return self.send_json({"ok": False, "fehler": str(exc), "code": "not_installed"}, 409)
            except ValueError as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 500)

        if route == "/api/language/grammar/install":
            try:
                return self.send_json(LANGUAGE.install_grammar())
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 500)

        if route == "/api/language/check":
            try:
                request = self._read_json_body()
                words = request.get("customWords", [])
                if not isinstance(words, list): raise ValueError("invalid project dictionary")
                return self.send_json(LANGUAGE.check(str(request.get("language", "")), str(request.get("text", "")), words[:5000]))
            except PermissionError as exc:
                return self.send_json({"ok": False, "fehler": str(exc), "code": "external_opt_in_required"}, 403)
            except FileNotFoundError as exc:
                return self.send_json({"ok": False, "fehler": str(exc), "code": "not_installed"}, 409)
            except ValueError as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 503)

        if route == "/api/backup/restore":
            try:
                wunsch = self._read_json_body()
            except Exception:
                wunsch = {}
            world_id, snapshot_id = str(wunsch.get("worldId", "")), str(wunsch.get("snapshotId", ""))
            if not storage.WORLD_ID_RE.fullmatch(world_id):
                return self.send_json({"ok": False, "grund": "Invalid world id."}, 400)
            endpoint = backup_remote.default_endpoint()
            if not endpoint:
                return self.send_json({"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."})
            try:
                with _lock:
                    return self.send_json(restore_world_from_endpoint(session, world_id, snapshot_id, endpoint))
            except Exception as exc:
                return self.send_json({"ok": False, "grund": str(exc)}, 400)

        if route == "/api/backup":
            try:
                wunsch = self._read_json_body()
            except Exception:
                wunsch = {}
            nachricht = (wunsch.get("message") or "").strip()
            pushen = bool(wunsch.get("push"))
            if AUTH_ENABLED:
                ctx = self._resolve_world_or_respond(session, str(wunsch.get("worldId", "")))
                if ctx is None:
                    return
                git_ctx = ctx.git
            with _lock:
                # Read CURRENT_GIT inside the lock: /api/worlds/open|create can reassign
                # it concurrently, and reading it earlier would race against that.
                if not AUTH_ENABLED:
                    git_ctx = CURRENT_GIT
                if git_ctx is None:
                    ergebnis = {"ok": False, "grund": "No world is open.", "log": []}
                else:
                    ergebnis = WORLD_BACKUPS.commit(git_ctx, nachricht, pushen)
            for zeile in ergebnis.get("log", []):
                print(f"  · {datetime.now():%H:%M:%S}  {zeile}")
            if not ergebnis.get("ok"):
                print(f"  ! git: {ergebnis.get('grund','')}".replace("\n", " "))
            return self.send_json(ergebnis)

        if route == "/api/backups/restore":
            try:
                request = self._read_json_body()
                db_path = backups_dir = manuscripts_dir = profiles_dir = None
                if AUTH_ENABLED:
                    ctx = self._resolve_world_or_respond(session, str(request.get("worldId", "")))
                    if ctx is None:
                        return
                    db_path, backups_dir = ctx.db_path, ctx.backups_dir
                    manuscripts_dir, profiles_dir = ctx.manuscripts_dir, ctx.profiles_dir
                with _lock:
                    storage.restore_backup(str(request.get("name", "")), db_path=db_path, backups_dir=backups_dir)
                    manuscript, figures = storage.load_manuscript(db_path), storage.load_figures(db_path)
                    mirror_text(manuscript["chapters"], manuscript_dir=manuscripts_dir)
                    mirror_profiles(figures, profile_dir=profiles_dir)
                return self.send_json({"ok": True})
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)

        if route == "/api/assistant/install":
            # No worldId/world_ctx: the local runtime is one shared process-wide
            # resource, not scoped to a particular world. install_async() itself
            # guards against a second concurrent install; `started=False` just
            # means one was already running, not a failure -- the frontend polls
            # /api/assistant/install/status either way.
            started = install_async()
            return self.send_json({"ok": True, "started": started})

        if route == "/api/assistant/chat":
            db_path = None
            try:
                request = self._read_json_body()
                question = str(request.get("question", "")).strip()
                history = request.get("history") if isinstance(request.get("history"), list) else []
                chapter_ids = [str(item) for item in request.get("chapterIds") or [] if isinstance(item, str)][:50]
                run_batches = bool(request.get("runBatches"))
                progress_id = str(request.get("progressId") or "")[:64] or None
                requested_language = str(request.get("language") or "")
                language = requested_language if requested_language in ASSISTANT_REPLY_LANGUAGES else DEFAULT_ASSISTANT_LANGUAGE
                if AUTH_ENABLED:
                    ctx = self._resolve_world_or_respond(session, str(request.get("worldId", "")))
                    if ctx is None:
                        return
                    db_path = ctx.db_path
                if not question or len(question) > 4000:
                    raise ValueError("Die Nachricht muss zwischen 1 und 4000 Zeichen lang sein.")
                with _lock:
                    manuscript, figures = storage.load_manuscript(db_path), storage.load_figures(db_path)
                result = ASSISTANT.complete(question, manuscript, figures, history[-40:], chapter_ids, run_batches, progress_id, language)
                with _lock:
                    interaction_id = storage.log_assistant_interaction(question, result, db_path=db_path)
                print(f"  · {datetime.now():%H:%M:%S}  AI request {interaction_id} — {len(result.get('sources', []))} sources, {len(result.get('proposals', []))} proposals", flush=True)
                return self.send_json({"ok": True, "interactionId": interaction_id, **result})
            except Exception as exc:
                if "question" in locals() and question:
                    with _lock:
                        interaction_id = storage.log_assistant_interaction(question, error=str(exc), db_path=db_path)
                    print(f"  ! {datetime.now():%H:%M:%S}  AI request {interaction_id} failed — {exc}", flush=True)
                message = str(exc)
                error_type = ("context_too_large" if "Kontextfenster" in message else "runtime_unavailable" if "nicht erreichbar" in message or "nicht installiert" in message else "response_truncated" if "nicht rechtzeitig" in message else "validation_error" if "strukturiert" in message or "gültig" in message else "timeout" if "Zeit" in message or "timeout" in message.casefold() else "assistant_error")
                return self.send_json({"ok": False, "fehler": message, "errorType": error_type}, 503)

        if route not in ROUTES:
            return self.send_error(404)
        validate, after = ROUTES[route]

        try:
            payload = self._read_json_body()
            # worldId is routing metadata, not document content — always strip it
            # before validation/storage (regardless of AUTH_ENABLED: the frontend
            # sends it once any world is open, auth or not) so it never persists
            # into extra_json.
            world_id_from_body = str(payload.pop("worldId", "")) if isinstance(payload, dict) else ""
            if not validate(payload):
                raise ValueError
        except Exception:
            return self.send_json({"ok": False, "fehler": "kein gültiger Zustand"}, 400)

        world_ctx = None
        if AUTH_ENABLED:
            world_ctx = self._resolve_world_or_respond(session, world_id_from_body)
            if world_ctx is None:
                return
        db_path = world_ctx.db_path if world_ctx else None
        backups_dir = world_ctx.backups_dir if world_ctx else None
        manuscripts_dir = world_ctx.manuscripts_dir if world_ctx else None
        profiles_dir = world_ctx.profiles_dir if world_ctx else None

        with _lock:
            try:
                storage.backup_if_due(db_path=db_path, backups_dir=backups_dir)
                kind = "manuscript" if route == "/api/manuscript" else "figures"
                match = self.headers.get("If-Match", "").strip('"')
                expected = int(match) if match.isdigit() else None
                updated_revision = storage.save_with_revision(kind, payload, expected, db_path=db_path)
                if AUTH_ENABLED:
                    if route == "/api/manuscript":
                        mirror_text(payload["chapters"], manuscript_dir=manuscripts_dir)
                    else:
                        mirror_profiles(payload, profile_dir=profiles_dir)
                elif after:
                    after(payload)
            except storage.ConflictError as exc:
                return self.send_json({"ok": False, "fehler": str(exc), "code": "conflict"}, 409)
            except Exception as exc:
                print(f"  ! Speichern fehlgeschlagen: {exc}")
                return self.send_json({"ok": False, "fehler": str(exc)}, 500)

        now = datetime.now().strftime("%H:%M:%S")
        if route == "/api/manuscript":
            chs = payload["chapters"]
            woerter = sum(len((c.get("body") or "").split()) for c in chs)
            print(f"  · {now}  Text gespeichert — {len(chs)} Kapitel, {woerter} Wörter")
        else:
            print(f"  · {now}  Figuren gespeichert — "
                  f"{len(payload['nodes'])} Figuren, {len(payload['edges'])} Verbindungen")
        return self.send_json({"ok": True, "zeit": now, "revision": updated_revision}, headers={"ETag": f'"{updated_revision}"'})

    do_PUT = _save
    do_POST = _save


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def run(port: int = 8000, no_open: bool = False) -> None:
    ensure_dirs()
    url = f"http://localhost:{port}/"

    print()
    print(f"  Quiltor · Autorenwerkstatt · v{VERSION}")
    print("  " + "─" * 52)
    print(f"  Adresse    {url}")
    print(f"  Datenbank  {storage.DB}")
    print(f"  Manuscripts {MANUSCRIPT_DIR}")
    print(f"  Profiles    {PROFILE_DIR}")
    print(f"  Backups     {BACKUPS}")
    if AUTH_ENABLED:
        print(f"  Auth        Keycloak ({auth.ISSUER})")
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
    positional = [a for a in argv if not a.startswith("--")]
    port = int(positional[0]) if positional else 8000
    run(port=port, no_open=no_open)


if __name__ == "__main__":
    main()
