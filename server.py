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

Standard library only. No installation required.
"""

import http.server
import json
import os
import re
import subprocess
import socketserver
import sys
import threading
import tempfile
import webbrowser
from datetime import datetime
from pathlib import Path

from backend import storage
from backend.git_backup import GitBackup
from backend.validation import valid_figures, valid_manuscript

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "dist"
DATA = storage.DATA
BACKUPS = DATA / "backups"
MANUSCRIPT_DIR = DATA / "manuscripts"
PROFILE_DIR = DATA / "profiles"
WORLD_BACKUPS = GitBackup(DATA / "repositories")

MAX_BODY = 16 * 1024 * 1024 # 16 MB limit per save request

_lock = threading.Lock()

# Only files matching this pattern may be cleaned from the mirror directories.
MIRROR_RE = re.compile(r"^\d{2,3} - .*\.md$")


# ---------------------------------------------------------------- Storage

def ensure_dirs() -> None:
    for d in (DATA, BACKUPS, MANUSCRIPT_DIR, PROFILE_DIR):
        d.mkdir(exist_ok=True)


# ------------------------------------------------ Human-readable text mirror

def safe_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title or "").strip()
    name = re.sub(r"\s+", " ", name)
    return (name or "Ohne Titel")[:70]


def mirror_text(chapters) -> None:
    """Write every chapter to Markdown for reading, backups, and versioning."""
    ensure_dirs()
    expected_files = set()
    for i, ch in enumerate(chapters, start=1):
        title = ch.get("title") or f"Kapitel {i}"
        fname = f"{i:02d} - {safe_name(title)}.md"
        expected_files.add(fname)
        body = ch.get("body") or ""
        note = (ch.get("note") or "").strip()
        text = f"# {title}\n\n{body.rstrip()}\n"
        if note:
            text += "\n---\n\n<!-- Notiz\n" + note.rstrip() + "\n-->\n"
        path = MANUSCRIPT_DIR / fname
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        path.write_text(text, encoding="utf-8")
    # Remove orphaned mirrors, touching only files owned by this application.
    for f in MANUSCRIPT_DIR.glob("*.md"):
        if f.name not in expected_files and MIRROR_RE.match(f.name):
            f.unlink(missing_ok=True)


PROFILE_FIELDS = [
    ("alter",       "Alter"),
    ("rolle",       "Rolle in der Geschichte"),
    ("aussehen",    "Aussehen"),
    ("herkunft",    "Herkunft & Vorgeschichte"),
    ("stimme",      "Stimme & Sprechweise"),
    ("notizen",     "Notizen"),
]


def mirror_profiles(state) -> None:
    """Write every character profile to readable, versionable Markdown."""
    ensure_dirs()
    nodes = state.get("nodes", [])
    edges = state.get("edges", [])
    names = {n.get("id"): (n.get("name") or "Ohne Namen") for n in nodes}
    expected_files = set()

    for i, n in enumerate(nodes, start=1):
        name = n.get("name") or "Ohne Namen"
        fname = f"{i:02d} - {safe_name(name)}.md"
        expected_files.add(fname)

        lines = [f"# {name}", ""]
        if n.get("label"):
            lines += [f"*{n['label']}*", ""]
        if n.get("sub"):
            lines += [n["sub"], ""]

        prof = n.get("profile") or {}
        for key, heading in PROFILE_FIELDS:
            value = (prof.get(key) or "").strip()
            if value:
                lines += [f"## {heading}", "", value, ""]
        for extra in prof.get("extra") or []:
            k = (extra.get("k") or "").strip()
            v = (extra.get("v") or "").strip()
            if k or v:
                lines += [f"## {k or 'Ohne Titel'}", "", v, ""]

        relationships = []
        for e in edges:
            if e.get("from") == n.get("id"):
                relationships.append(f"- → {names.get(e.get('to'), '?')}"
                            + (f" — {e['label']}" if e.get("label") else ""))
            elif e.get("to") == n.get("id"):
                relationships.append(f"- ← {names.get(e.get('from'), '?')}"
                            + (f" — {e['label']}" if e.get("label") else ""))
        if relationships:
            lines += ["## Verbindungen im Diagramm", ""] + relationships + [""]

        text = "\n".join(lines).rstrip() + "\n"
        path = PROFILE_DIR / fname
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        path.write_text(text, encoding="utf-8")

    for f in PROFILE_DIR.glob("*.md"):
        if f.name not in expected_files and MIRROR_RE.match(f.name):
            f.unlink(missing_ok=True)


# --------------------------------------------------------------------- Git

GIT_ENV = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",   # never request credentials interactively
    "GIT_ASKPASS": "echo",        # and never open a credential dialog
    "GCM_INTERACTIVE": "never",
    "LC_ALL": "C",
}


def git(*args, timeout=90):
    """Run Git in the application directory without a shell or prompts."""
    return subprocess.run(
        # quotepath=false keeps non-ASCII file names human-readable.
        ["git", "-c", "core.quotepath=false", "-C", str(BASE), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout, env=GIT_ENV,
    )


def git_status() -> dict:
    try:
        probe = git("rev-parse", "--is-inside-work-tree", timeout=10)
    except FileNotFoundError:
        return {"ok": False, "grund": "git ist nicht installiert."}
    except Exception as exc:
        return {"ok": False, "grund": str(exc)}

    if probe.returncode != 0:
        return {"ok": False, "grund": "Dieser Ordner liegt in keinem Git-Repository."}

    def out(*a, **kw):
        r = git(*a, **kw)
        return r.stdout.strip() if r.returncode == 0 else ""

    branch = out("rev-parse", "--abbrev-ref", "HEAD", timeout=10) or "?"
    upstream = out("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", timeout=10)
    remote = out("remote", "get-url", "origin", timeout=10)
    name = out("config", "user.name", timeout=10)
    mail = out("config", "user.email", timeout=10)

    raw_status = git("status", "--porcelain", "--", ".", timeout=20)
    changes = [line for line in raw_status.stdout.splitlines() if line.strip()]

    ahead = 0
    if upstream:
        count = out("rev-list", "--count", f"{upstream}..HEAD", timeout=15)
        ahead = int(count) if count.isdigit() else 0

    return {
        "ok": True,
        "branch": branch,
        "upstream": upstream,
        "remote": remote,
        "identitaet": bool(name and mail),
        "aenderungen": changes[:60],
        "anzahl": len(changes),
        "unveroeffentlicht": ahead,
        "vorschlag": commit_vorschlag(),
    }


def commit_vorschlag() -> str:
    parts = []
    manuscript = storage.load_manuscript()
    if manuscript and isinstance(manuscript.get("chapters"), list):
        chapters = manuscript["chapters"]
        word_count = sum(len((chapter.get("body") or "").split()) for chapter in chapters)
        parts.append(f"{len(chapters)} Kapitel, {word_count} Wörter")
    fig = storage.load_figures()
    if fig and isinstance(fig.get("nodes"), list):
        parts.append(f"{len(fig['nodes'])} Figuren")
    stand = " · ".join(parts) if parts else "Arbeitsstand"
    return f"Schreibstand {datetime.now():%Y-%m-%d %H:%M} — {stand}"


def git_commit(nachricht: str, pushen: bool) -> dict:
    log = []
    st = git_status()
    if not st.get("ok"):
        return {"ok": False, "grund": st.get("grund"), "log": log}
    if not st["identitaet"]:
        return {"ok": False, "log": log, "grund":
                "Git kennt deinen Namen noch nicht. Einmalig im Terminal:\n"
                '  git config --global user.name "Dein Name"\n'
                '  git config --global user.email "du@example.com"'}

    r = git("add", "-A", "--", ".", timeout=60)
    if r.returncode != 0:
        return {"ok": False, "grund": r.stderr.strip() or "git add fehlgeschlagen", "log": log}

    etwas_da = git("diff", "--cached", "--quiet", timeout=30).returncode != 0

    if etwas_da:
        r = git("commit", "-m", nachricht or commit_vorschlag(), timeout=60)
        if r.returncode != 0:
            return {"ok": False, "grund": (r.stderr or r.stdout).strip(), "log": log}
        log.append("Commit angelegt: " + (nachricht or "").strip())
    else:
        log.append("Nichts zu committen — alles schon gesichert.")

    if not pushen:
        return {"ok": True, "log": log, "status": git_status()}

    if not st["upstream"]:
        return {"ok": False, "log": log, "grund":
                "Für diesen Branch ist kein Ziel eingerichtet. Einmalig im Terminal:\n"
                f"  git push -u origin {st['branch']}"}

    try:
        r = git("push", timeout=180)
    except subprocess.TimeoutExpired:
        return {"ok": False, "log": log, "grund":
                "Push hat zu lange gebraucht — vermutlich fehlen Zugangsdaten. "
                "Einmal im Terminal pushen, danach merkt Git sie sich."}
    if r.returncode != 0:
        return {"ok": False, "log": log, "grund": (r.stderr or r.stdout).strip()}

    log.append("Gepusht nach " + (st["upstream"] or "origin"))
    return {"ok": True, "log": log, "status": git_status()}


def git_log(n: int = 40) -> list:
    """Return the most recent commits that affect this directory."""
    r = git("log", f"-{n}", "--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s",
            "--date=format:%d.%m.%Y %H:%M", "--", ".", timeout=30)
    if r.returncode != 0:
        return []
    entries = []
    for line in r.stdout.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 5:
            entries.append({"hash": parts[0], "kurz": parts[1],
                            "datum": parts[2], "autor": parts[3], "betreff": parts[4]})
    return entries


# Compare readable mirrors by default so Git history remains understandable.
TEXT_PATHS = ["data/manuscripts", "data/profiles"]


def git_diff(ref: str, nur_text: bool = True, wortweise: bool = True) -> dict:
    st = git("rev-parse", "--is-inside-work-tree", timeout=10)
    if st.returncode != 0:
        return {"ok": False, "grund": "Dieser Ordner liegt in keinem Git-Repository."}

    paths = ["--", *TEXT_PATHS] if nur_text else ["--", "."]
    opts = ["--word-diff=plain", "--word-diff-regex=[^[:space:]]+"] if wortweise else []
    opts += ["--unified=1"] if wortweise else ["--unified=3"]

    new_files = []
    if ref in ("", "WORK", None):
        has_head = git("rev-parse", "--verify", "HEAD", timeout=10).returncode == 0
        if has_head:
            r = git("diff", "HEAD", *opts, *paths, timeout=60)
        else:
            r = git("diff", *opts, *paths, timeout=60)
        raw_status = git("status", "--porcelain", "--untracked-files=all", "--", ".", timeout=30)
        new_files = [line[3:].strip('"') for line in raw_status.stdout.splitlines() if line.startswith("??")]
    else:
        if not ref.replace("-", "").isalnum():
            return {"ok": False, "grund": "Ungültige Angabe."}
        r = git("show", "--patch", "--format=", ref, *opts, *paths, timeout=60)

    if r.returncode not in (0, 1):
        return {"ok": False, "grund": (r.stderr or r.stdout).strip()}
    return {"ok": True, "diff": r.stdout, "neu": new_files, "wortweise": wortweise}


def alte_kapitelfassung(ref: str, kapitel_index: int, titel: str) -> dict:
    """Return plain chapter text for an editor-side comparison.

    The lookup follows the mirror filename. A changed title or chapter order
    may therefore make an older file appear as a newly created chapter.
    """
    st = git("rev-parse", "--is-inside-work-tree", timeout=10)
    if st.returncode != 0:
        return {"ok": False, "grund": "Dieser Ordner liegt in keinem Git-Repository."}
    zielref = "HEAD" if ref in ("", "WORK", None) else ref
    if not zielref.replace("-", "").isalnum():
        return {"ok": False, "grund": "Ungültige Angabe."}
    fname = f"{kapitel_index:02d} - {safe_name(titel)}.md"
    path = f"data/manuscripts/{fname}"
    r = git("show", f"{zielref}:{path}", timeout=30)
    if r.returncode != 0:
        return {"ok": True, "neu": True, "text": ""}
    text = r.stdout
    # Strip the Markdown title.
    parts = text.split("\n\n", 1)
    body = parts[1] if len(parts) > 1 else text
    # Strip the optional note appendix.
    body = body.split("\n---\n\n<!-- Notiz", 1)[0]
    return {"ok": True, "neu": False, "text": body.rstrip("\n")}


# ------------------------------------------------------------------ Server

ROUTES = {
    "/api/state":      (valid_figures, mirror_profiles),
    "/api/manuscript": (valid_manuscript, lambda p: mirror_text(p["chapters"])),
}


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        # Only the built Vite client is public; databases and mirrors stay private.
        super().__init__(*args, directory=str(PUBLIC if PUBLIC.exists() else BASE), **kwargs)

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

    def log_message(self, fmt, *args):
        pass  # Suppress default noise; meaningful operations are logged explicitly.

    # ---------- Routes ----------

    def do_GET(self):
        route = self.path.split("?")[0]
        if route == "/api/worlds":
            with _lock:
                return self.send_json({"ok": True, "worlds": storage.list_worlds()})
        if route == "/api/git":
            with _lock:
                return self.send_json(WORLD_BACKUPS.status())

        if route == "/api/log":
            with _lock:
                return self.send_json({"ok": True, "commits": WORLD_BACKUPS.history()})

        if route == "/api/backups":
            with _lock:
                return self.send_json({"ok": True, "backups": storage.list_backups()})

        if route == "/api/diff":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            ref = (q.get("ref") or ["WORK"])[0]
            nur_text = (q.get("alles") or ["0"])[0] != "1"
            wortweise = (q.get("modus") or ["wort"])[0] == "wort"
            with _lock:
                return self.send_json(WORLD_BACKUPS.diff(ref, nur_text, wortweise))

        if route == "/api/textfassung":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            ref = (q.get("ref") or ["WORK"])[0]
            titel = (q.get("titel") or [""])[0]
            kap = (q.get("kapitel") or [""])[0]
            if not kap.isdigit():
                return self.send_json({"ok": False, "grund": "Kapitel fehlt."})
            with _lock:
                return self.send_json(WORLD_BACKUPS.chapter_version(ref, int(kap), safe_name(titel)))
        if route in ROUTES:
            with _lock:
                kind = "figures" if route == "/api/state" else "manuscript"
                data = storage.load_figures() if kind == "figures" else storage.load_manuscript()
                return self.send_json(data, headers={"ETag": f'"{storage.revision(kind)}"'})
        if route == "/":
            self.path = "/index.html"
        return super().do_GET()

    def _save(self):
        route = self.path.split("?")[0]

        if route in ("/api/worlds/open", "/api/worlds/create"):
            length = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                with _lock:
                    if route.endswith("/create"):
                        created = storage.create_world(str(payload.get("title", "")), str(payload.get("githubUrl", "")))
                        world = storage.activate_world(created["id"])
                    else:
                        world = storage.activate_world(str(payload.get("id", "")))
                    WORLD_BACKUPS.activate(world["id"], world["githubUrl"], storage.DB, MANUSCRIPT_DIR, PROFILE_DIR)
                return self.send_json({"ok": True, "world": world})
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)

        if route == "/api/book.pdf":
            port = self.server.server_address[1]
            script = BASE / "scripts" / "render-book-pdf.mjs"
            target_name = ""
            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as target:
                    target_name = target.name
                result = subprocess.run(
                    ["node", str(script), f"http://127.0.0.1:{port}/?world={storage.ACTIVE_WORLD_ID}", target_name],
                    cwd=BASE, capture_output=True, text=True, timeout=90,
                )
                if result.returncode != 0:
                    raise RuntimeError((result.stderr or result.stdout or "PDF-Renderer fehlgeschlagen.").strip())
                return self.send_pdf(Path(target_name).read_bytes())
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": f"PDF konnte nicht erzeugt werden: {exc}"}, 500)
            finally:
                if target_name:
                    Path(target_name).unlink(missing_ok=True)

        if route == "/api/git":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                wunsch = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            except Exception:
                wunsch = {}
            nachricht = (wunsch.get("message") or "").strip()
            pushen = bool(wunsch.get("push"))
            with _lock:
                ergebnis = WORLD_BACKUPS.commit(nachricht, pushen)
            for zeile in ergebnis.get("log", []):
                print(f"  · {datetime.now():%H:%M:%S}  {zeile}")
            if not ergebnis.get("ok"):
                print(f"  ! git: {ergebnis.get('grund','')}".replace("\n", " "))
            return self.send_json(ergebnis)

        if route == "/api/backups/restore":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                request = json.loads(self.rfile.read(length).decode("utf-8"))
                with _lock:
                    storage.restore_backup(str(request.get("name", "")))
                    manuscript, figures = storage.load_manuscript(), storage.load_figures()
                    mirror_text(manuscript["chapters"]); mirror_profiles(figures)
                return self.send_json({"ok": True})
            except Exception as exc:
                return self.send_json({"ok": False, "fehler": str(exc)}, 400)

        if route not in ROUTES:
            return self.send_error(404)
        validate, after = ROUTES[route]

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_json({"ok": False, "fehler": "ungültige Größe"}, 400)

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not validate(payload):
                raise ValueError
        except Exception:
            return self.send_json({"ok": False, "fehler": "kein gültiger Zustand"}, 400)

        with _lock:
            try:
                storage.backup_if_due()
                kind = "manuscript" if route == "/api/manuscript" else "figures"
                match = self.headers.get("If-Match", "").strip('"')
                expected = int(match) if match.isdigit() else None
                if route == "/api/manuscript":
                    updated_revision = storage.save_with_revision(kind, payload, expected)
                else:
                    updated_revision = storage.save_with_revision(kind, payload, expected)
                if after:
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


def main() -> None:
    argv = sys.argv[1:]
    no_open = "--no-open" in argv
    positional = [a for a in argv if not a.startswith("--")]
    port = int(positional[0]) if positional else 8000

    ensure_dirs()
    url = f"http://localhost:{port}/"

    print()
    print("  Quiltor · Autorenwerkstatt")
    print("  " + "─" * 52)
    print(f"  Adresse    {url}")
    print(f"  Datenbank  {storage.DB}")
    print(f"  Manuscripts {MANUSCRIPT_DIR}")
    print(f"  Profiles    {PROFILE_DIR}")
    print(f"  Backups     {BACKUPS}")
    print("  Stop        Ctrl+C")
    print("  " + "─" * 52)
    print()

    if not no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        with Server(("127.0.0.1", port), Handler) as httpd:
            httpd.serve_forever()
    except OSError as exc:
        print(f"  ! Port {port} ist belegt ({exc}).")
        print(f"  ! Versuch es mit:  python3 server.py {port + 1}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Stopped. Your work is stored in data/\n")


if __name__ == "__main__":
    main()
