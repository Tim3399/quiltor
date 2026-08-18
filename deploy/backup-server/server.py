#!/usr/bin/env python3
"""Reference implementation of the Quiltor backup endpoint.

Run it, point a world's backup URL at it, done:

    QUILTOR_BACKUP_OIDC_ISSUER=https://keycloak.example.com/realms/quiltor \
    QUILTOR_BACKUP_OIDC_CLIENT_ID=quiltor-backup-server \
    QUILTOR_BACKUP_OIDC_CLIENT_SECRET=... \
    QUILTOR_BACKUP_PUBLIC_URL=https://backup.example.com \
    python3 deploy/backup-server/server.py --port 9000

It exists so that "host your own backups" is a real option rather than a claim.
It is also the shape a paid hosted endpoint would take -- swap the filesystem for
object storage and put a real reverse proxy with TLS in front; the protocol does
not change.

Storage is a plain directory tree, one per account:

    {root}/{account}/{world}/blobs/{sha256}
    {root}/{account}/{world}/snapshots/{id}.json

...where {account} is the `sub` of the token that stored it. The client never
names the account, which is what keeps one out of another's worlds: ownership is
derived here, not asserted there.

Blobs are content-addressed and immutable: the server verifies that the bytes it
receives actually hash to the name they were sent under, so a corrupted or
malicious upload cannot quietly replace a chapter's contents. Snapshots are
written last by the client, so a manifest is only ever stored once its blobs are.

Access is an OIDC access token, checked by introspection (RFC 7662) against the
issuer below, and it must carry the expected scope. There is no mode without
authentication -- an endpoint holding whole manuscripts has no sensible one.
`GET /.well-known/oauth-protected-resource` (RFC 9728) publishes which issuer
this server trusts, so a client that knows only the backup URL can find its way
to the login without being configured a second time.

Standard library only, like the rest of Quiltor. Deliberately not a dependency of
the app -- nothing in backend/ imports this.
"""

from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import re
import socketserver
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
MAX_BLOB = 512 * 1024 * 1024

ROOT = Path(os.environ.get("QUILTOR_BACKUP_ROOT", "./backup-data")).resolve()

# Module globals rather than values re-read at each use, so the test suite can
# point them at a fake issuer the same way it already redirects ROOT.
ISSUER = os.environ.get("QUILTOR_BACKUP_OIDC_ISSUER", "").rstrip("/")
CLIENT_ID = os.environ.get("QUILTOR_BACKUP_OIDC_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("QUILTOR_BACKUP_OIDC_CLIENT_SECRET", "")
REQUIRED_SCOPE = os.environ.get("QUILTOR_BACKUP_OIDC_SCOPE", "quiltor.backup")
PUBLIC_URL = os.environ.get("QUILTOR_BACKUP_PUBLIC_URL", "").rstrip("/")

METADATA_PATH = "/.well-known/oauth-protected-resource"

# Introspection costs a round trip to the issuer, so the verdict is cached -- but
# briefly. Preferring introspection over checking a signature locally is what
# makes a revoked token stop working; a long cache would trade that back away.
TOKEN_TTL = 60.0
TOKEN_CACHE_MAX = 512
HTTP_TIMEOUT = 10

_lock = threading.Lock()
_discovery: dict[str, dict] = {}
_tokens: dict[str, tuple[float, dict]] = {}


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(
        url, timeout=HTTP_TIMEOUT, context=ssl.create_default_context()
    ) as response:
        return json.loads(response.read().decode("utf-8"))


def _post_form(url: str, fields: dict[str, str]) -> dict:
    body = urllib.parse.urlencode(fields).encode("ascii")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    # Certificate-verified by default, and never anything else: this call carries
    # both a user's bearer token and this server's own client secret.
    with urllib.request.urlopen(
        request, timeout=HTTP_TIMEOUT, context=ssl.create_default_context()
    ) as response:
        return json.loads(response.read().decode("utf-8"))


def discover() -> dict:
    """The issuer's OpenID configuration, fetched once and kept."""
    with _lock:
        cached = _discovery.get(ISSUER)
    if cached is not None:
        return cached
    document = _get_json(f"{ISSUER}/.well-known/openid-configuration")
    with _lock:
        _discovery[ISSUER] = document
    return document


def introspect(token: str) -> dict | None:
    """The issuer's verdict on `token`, or None if none could be obtained.

    Returns the raw introspection response; judging `active` is the caller's
    business. Cached under a digest rather than under the token itself, so the
    secret does not sit around in readable form in a long-lived dict.
    """
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _lock:
        entry = _tokens.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]
    try:
        endpoint = discover().get("introspection_endpoint")
        if not endpoint:
            return None
        result = _post_form(
            endpoint, {"token": token, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET}
        )
    except (urllib.error.URLError, ValueError, OSError):
        # The issuer is unreachable or answered nonsense. That is not the same as
        # "the token is fine", and refusing is the only safe reading of it.
        return None
    with _lock:
        if len(_tokens) >= TOKEN_CACHE_MAX:
            for stale in [k for k, (expires, _) in _tokens.items() if expires <= now]:
                _tokens.pop(stale, None)
            if len(_tokens) >= TOKEN_CACHE_MAX:
                _tokens.pop(next(iter(_tokens)), None)
        _tokens[key] = (now + TOKEN_TTL, result)
    return result


def _scopes(claims: dict) -> set[str]:
    scope = claims.get("scope") or claims.get("scp") or ""
    return set(scope.split()) if isinstance(scope, str) else set(scope)


def metadata_document() -> dict:
    """RFC 9728 protected-resource metadata: which issuer guards this server."""
    return {
        "resource": PUBLIC_URL,
        "authorization_servers": [ISSUER],
        "scopes_supported": [REQUIRED_SCOPE],
        "bearer_methods_supported": ["header"],
    }


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "QuiltorBackup/1"

    def _reply(
        self,
        code: int,
        payload: dict | bytes,
        content_type: str = "application/json",
        headers: dict[str, str] | None = None,
    ) -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _unauthorized(self, detail: str) -> None:
        """401 plus the pointer a client needs to find the login on its own."""
        challenge = f'Bearer resource_metadata="{PUBLIC_URL}{METADATA_PATH}"'
        self._reply(401, {"error": detail}, headers={"WWW-Authenticate": challenge})

    def _account(self) -> str | None:
        """The verified account for this request, or None with the answer written.

        The account key is the token's `sub`: not the username and not the email,
        because both are mutable in Keycloak while `sub` is stable and opaque. It
        is also the directory name, so it is checked against NAME_RE rather than
        trusted -- a subject that cannot be a directory name is refused outright
        instead of being sanitised into somebody else's folder.
        """
        header = self.headers.get("Authorization", "")
        token = header[7:].strip() if header[:7].lower() == "bearer " else ""
        if not token:
            self._unauthorized("Missing bearer token.")
            return None
        claims = introspect(token)
        if claims is None or not claims.get("active"):
            self._unauthorized("Token is not active.")
            return None
        if REQUIRED_SCOPE not in _scopes(claims):
            # Authenticated but not entitled. 403 rather than 401: retrying with
            # the same token cannot help, and sending the caller back to the login
            # would misdescribe what went wrong.
            self._reply(403, {"error": f"Token lacks the {REQUIRED_SCOPE!r} scope."})
            return None
        subject = str(claims.get("sub") or "")
        if not NAME_RE.match(subject):
            self._reply(403, {"error": "Token subject is not a usable account key."})
            return None
        return subject

    def _world_index(self, account: str) -> list[dict]:
        """One entry per world this account has backups for, newest activity
        first. Titles come from the manifests themselves (see the "title" field
        written by backend/backup/snapshots.py), which is what lets a fresh
        install show world names instead of directory ids."""
        root = ROOT / account
        found = []
        for world_dir in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
            manifests = []
            for path in (world_dir / "snapshots").glob("*.json"):
                try:
                    manifests.append(json.loads(path.read_text(encoding="utf-8")))
                except ValueError:
                    continue
            if not manifests:
                continue
            manifests.sort(key=lambda m: m.get("created", ""))
            newest = manifests[-1]
            found.append(
                {
                    "id": world_dir.name,
                    "title": newest.get("title", ""),
                    "updated": newest.get("created", ""),
                    "snapshots": len(manifests),
                }
            )
        found.sort(key=lambda w: w["updated"], reverse=True)
        return found

    def _route(self) -> tuple[str, str, str] | None:
        """/v1/worlds/{world}/{kind}/{name} -> (world, kind, name); name may be ""."""
        parts = [p for p in self.path.split("?")[0].strip("/").split("/") if p]
        if len(parts) < 4 or parts[0] != "v1" or parts[1] != "worlds":
            return None
        world, kind = parts[2], parts[3]
        name = parts[4] if len(parts) > 4 else ""
        if not NAME_RE.match(world) or kind not in ("blobs", "snapshots"):
            return None
        if name and not (DIGEST_RE.match(name) if kind == "blobs" else NAME_RE.match(name)):
            return None
        return world, kind, name

    def do_PUT(self) -> None:
        account = self._account()
        if account is None:
            return  # _account already wrote the 401 or 403
        route = self._route()
        if route is None:
            return self._reply(404, {"error": "No such route."})
        world, kind, name = route
        if not name:
            return self._reply(405, {"error": "PUT requires a blob digest or snapshot id."})

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BLOB:
            return self._reply(413, {"error": "Payload too large."})
        payload = self.rfile.read(length)

        target = ROOT / account / world / kind / (name if kind == "blobs" else f"{name}.json")
        if kind == "blobs":
            # Content addressing is only a guarantee if it is enforced here too.
            actual = hashlib.sha256(payload).hexdigest()
            if actual != name:
                return self._reply(400, {"error": f"Content hashes to {actual}, not {name}."})
            if target.exists():
                return self._reply(200, {"ok": True, "stored": False})
        else:
            try:
                manifest = json.loads(payload)
                missing = [
                    d
                    for d in set(manifest.get("files", {}).values())
                    if not (ROOT / account / world / "blobs" / d).exists()
                ]
            except ValueError:
                return self._reply(400, {"error": "Snapshot manifest is not valid JSON."})
            if missing:
                # Refusing here is what keeps the store consistent: a manifest is
                # a promise that its content is retrievable.
                return self._reply(
                    409,
                    {
                        "error": f"{len(missing)} referenced blob(s) missing.",
                        "missing": missing[:20],
                    },
                )

        target.parent.mkdir(parents=True, exist_ok=True)
        staged = target.with_suffix(target.suffix + ".part")
        staged.write_bytes(payload)
        staged.replace(target)
        return self._reply(201, {"ok": True, "stored": True})

    def do_GET(self) -> None:
        # Answered before authentication, and that is the point: this is how a
        # client given nothing but a backup URL learns which issuer to log in to.
        # Publishing it costs nothing -- it names the guard, not the data.
        if self.path.split("?")[0] == METADATA_PATH:
            return self._reply(200, metadata_document())

        account = self._account()
        if account is None:
            return  # _account already wrote the 401 or 403
        if self.path.split("?")[0].strip("/") == "v1/worlds":
            return self._reply(200, {"worlds": self._world_index(account)})

        route = self._route()
        if route is None:
            return self._reply(404, {"error": "No such route."})
        world, kind, name = route
        directory = ROOT / account / world / kind

        if not name:
            if not directory.exists():
                return self._reply(200, {"blobs": []} if kind == "blobs" else {"snapshots": []})
            if kind == "blobs":
                return self._reply(
                    200,
                    {
                        "blobs": sorted(
                            p.name for p in directory.iterdir() if DIGEST_RE.match(p.name)
                        )
                    },
                )
            manifests = []
            for path in sorted(directory.glob("*.json")):
                try:
                    manifests.append(json.loads(path.read_text(encoding="utf-8")))
                except ValueError:
                    continue
            manifests.sort(key=lambda m: m.get("created", ""))
            return self._reply(200, {"snapshots": manifests})

        target = directory / (name if kind == "blobs" else f"{name}.json")
        if not target.exists():
            return self._reply(404, {"error": "Not found."})
        content_type = "application/octet-stream" if kind == "blobs" else "application/json"
        return self._reply(200, target.read_bytes(), content_type)

    def log_message(self, format: str, *args) -> None:
        print(f"  · {self.address_string()} {format % args}", flush=True)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Quiltor backup endpoint (reference implementation)."
    )
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    # Refusing to start beats starting unprotected: an endpoint holding whole
    # manuscripts has no sensible "no authentication configured" mode, so the
    # configuration is required rather than defaulted.
    missing = [
        name
        for name, value in (
            ("QUILTOR_BACKUP_OIDC_ISSUER", ISSUER),
            ("QUILTOR_BACKUP_OIDC_CLIENT_ID", CLIENT_ID),
            ("QUILTOR_BACKUP_OIDC_CLIENT_SECRET", CLIENT_SECRET),
            ("QUILTOR_BACKUP_PUBLIC_URL", PUBLIC_URL),
        )
        if not value
    ]
    if missing:
        raise SystemExit("Set " + ", ".join(missing) + " before starting.")
    ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Quiltor backup endpoint on http://{args.host}:{args.port}  ->  {ROOT}")
    print(f"  Issuer  {ISSUER}")
    print(f"  Scope   {REQUIRED_SCOPE}")
    with Server((args.host, args.port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
