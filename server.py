#!/usr/bin/env python3
"""
Quiltor — small local writing server

Two workspaces at one address; SQLite is the authoritative store:
  · Worlds                            → data/worlds/*.sqlite3
  · Characters  Relationship graph and profiles in SQLite
                readable profiles   → data/profiles/NN - Name.md
  · Text        Manuscript in SQLite
  · Git         Commit and push from the UI
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

from backend.llm.shared.platform import force_utf8_streams

force_utf8_streams()

from backend import auth, storage
from backend.assistant import AssistantRuntime, read_progress
from backend.git_backup import GitBackup, GitContext
from backend.knowledge import build_knowledge
from backend.llm.installer import ensure_installed
from backend.mirror import mirror_profiles, mirror_text, safe_name
from backend.render import RENDER_TOKEN_TTL, issue_render_token, redeem_render_token, render_pdf
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
WORLD_BACKUPS = GitBackup(DATA / "repositories")
# The single "currently open" world's Git backup context (local single-user mode
# mirrors storage.DB/ACTIVE_WORLD_ID: one process, one active world at a time).
CURRENT_GIT: GitContext | None = None
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
    git: GitContext | None


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
    repository_url = (world or {}).get("gitUrl", "")
    git_ctx = (WORLD_BACKUPS.context(world_id, repository_url, db_path, manuscripts_dir, profiles_dir)
               if repository_url else None)
    return WorldContext(id=world_id, db_path=db_path, backups_dir=backups_dir,
                         manuscripts_dir=manuscripts_dir, profiles_dir=profiles_dir, git=git_ctx)


# ---------------------------------------------------------------- Storage

def ensure_dirs() -> None:
    # parents=True: DATA's parent is QUILTOR_HOME for a pip/pipx install, which
    # (unlike the package root a source checkout/Docker uses) may not exist yet.
    for d in (DATA, BACKUPS, MANUSCRIPT_DIR, PROFILE_DIR):
        d.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------ Server

ROUTES = {
    "/api/state":      (valid_figures, lambda p: mirror_profiles(p, PROFILE_DIR)),
    "/api/manuscript": (valid_manuscript, lambda p: mirror_text(p["chapters"], MANUSCRIPT_DIR)),
}


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
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("ungültige Größe")
        return json.loads(self.rfile.read(length).decode("utf-8"))

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
        from urllib.parse import parse_qs, urlparse
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
        route = self.path.split("?")[0]
        from urllib.parse import parse_qs, urlparse
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
        if AUTH_ENABLED and route in ("/api/git", "/api/log", "/api/backups", "/api/assistant/status",
                                       "/api/assistant/logs", "/api/diff", "/api/textfassung",
                                       "/api/state", "/api/manuscript"):
            world_ctx = self._resolve_world_or_respond(session, world_id)
            if world_ctx is None:
                return
        db_path = world_ctx.db_path if world_ctx else None
        git_ctx = world_ctx.git if world_ctx else CURRENT_GIT

        if route == "/api/git":
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No Git backup is configured for this world."})
                return self.send_json(WORLD_BACKUPS.status(git_ctx))

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
            return self.send_json({"ok": True, **ASSISTANT.status(), "chunks": len(build_knowledge(manuscript, figures))})

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

        if route == "/api/diff":
            ref = (query.get("ref") or ["WORK"])[0]
            nur_text = (query.get("alles") or ["0"])[0] != "1"
            wortweise = (query.get("modus") or ["wort"])[0] == "wort"
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No Git backup is configured for this world."})
                return self.send_json(WORLD_BACKUPS.diff(git_ctx, ref, nur_text, wortweise))

        if route == "/api/textfassung":
            ref = (query.get("ref") or ["WORK"])[0]
            titel = (query.get("titel") or [""])[0]
            kap = (query.get("kapitel") or [""])[0]
            if not kap.isdigit():
                return self.send_json({"ok": False, "grund": "Kapitel fehlt."})
            with _lock:
                if git_ctx is None:
                    return self.send_json({"ok": False, "grund": "No Git backup is configured for this world."})
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
                        world = storage.create_world(str(payload.get("title", "")), str(payload.get("gitUrl", "")), owner_sub=owner_sub)
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
                        if world.get("gitUrl"):
                            CURRENT_GIT = WORLD_BACKUPS.context(world["id"], world["gitUrl"], storage.DB, MANUSCRIPT_DIR, PROFILE_DIR)
                        else:
                            CURRENT_GIT = None
                return self.send_json({"ok": True, "world": world})
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)

        if route == "/api/book.pdf":
            port = self.server.server_address[1]
            script = BASE / "scripts" / "render-book-pdf.mjs"
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
                return self.send_pdf(render_pdf(script, BASE, target_url))
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

        if route == "/api/git":
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
                    ergebnis = {"ok": False, "grund": "No Git backup is configured for this world.", "log": []}
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

        if route == "/api/assistant/chat":
            db_path = None
            try:
                request = self._read_json_body()
                question = str(request.get("question", "")).strip()
                history = request.get("history") if isinstance(request.get("history"), list) else []
                chapter_ids = [str(item) for item in request.get("chapterIds") or [] if isinstance(item, str)][:50]
                run_batches = bool(request.get("runBatches"))
                progress_id = str(request.get("progressId") or "")[:64] or None
                if AUTH_ENABLED:
                    ctx = self._resolve_world_or_respond(session, str(request.get("worldId", "")))
                    if ctx is None:
                        return
                    db_path = ctx.db_path
                if not question or len(question) > 4000:
                    raise ValueError("Die Nachricht muss zwischen 1 und 4000 Zeichen lang sein.")
                with _lock:
                    manuscript, figures = storage.load_manuscript(db_path), storage.load_figures(db_path)
                result = ASSISTANT.complete(question, manuscript, figures, history[-40:], chapter_ids, run_batches, progress_id)
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


def main() -> None:
    argv = sys.argv[1:]
    no_open = "--no-open" in argv
    positional = [a for a in argv if not a.startswith("--")]
    port = int(positional[0]) if positional else 8000
    run(port=port, no_open=no_open)


if __name__ == "__main__":
    main()
