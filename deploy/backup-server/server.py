#!/usr/bin/env python3
"""Reference implementation of the Quiltor backup endpoint.

Run it, point a world's backup URL at it, done:

    QUILTOR_BACKUP_TOKENS=alice:s3cret python3 deploy/backup-server/server.py --port 9000

It exists so that "host your own backups" is a real option rather than a claim.
It is also the shape a paid hosted endpoint would take -- swap the filesystem for
object storage and put a real reverse proxy with TLS in front; the protocol does
not change.

Storage is a plain directory tree, one per account:

    {root}/{account}/{world}/blobs/{sha256}
    {root}/{account}/{world}/snapshots/{id}.json

Blobs are content-addressed and immutable: the server verifies that the bytes it
receives actually hash to the name they were sent under, so a corrupted or
malicious upload cannot quietly replace a chapter's contents. Snapshots are
written last by the client, so a manifest is only ever stored once its blobs are.

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
from pathlib import Path

DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
MAX_BLOB = 512 * 1024 * 1024

ROOT = Path(os.environ.get("QUILTOR_BACKUP_ROOT", "./backup-data")).resolve()


def _accounts() -> dict[str, str]:
    """Token -> account name, from QUILTOR_BACKUP_TOKENS="alice:s3cret,bob:hunter2".

    Kept this crude on purpose: a self-hoster wants one env var, and a hosted
    deployment replaces this function with a lookup against its own user table.
    """
    mapping = {}
    for pair in os.environ.get("QUILTOR_BACKUP_TOKENS", "").split(","):
        account, _, token = pair.strip().partition(":")
        if account and token:
            mapping[token] = account
    return mapping


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "QuiltorBackup/1"

    def _reply(self, code: int, payload: dict | bytes, content_type: str = "application/json") -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _account(self) -> str | None:
        header = self.headers.get("Authorization", "")
        token = header[7:].strip() if header.startswith("Bearer ") else ""
        return _accounts().get(token)

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
            return self._reply(401, {"error": "Unknown or missing bearer token."})
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
                missing = [d for d in set(manifest.get("files", {}).values())
                           if not (ROOT / account / world / "blobs" / d).exists()]
            except ValueError:
                return self._reply(400, {"error": "Snapshot manifest is not valid JSON."})
            if missing:
                # Refusing here is what keeps the store consistent: a manifest is
                # a promise that its content is retrievable.
                return self._reply(409, {"error": f"{len(missing)} referenced blob(s) missing.", "missing": missing[:20]})

        target.parent.mkdir(parents=True, exist_ok=True)
        staged = target.with_suffix(target.suffix + ".part")
        staged.write_bytes(payload)
        staged.replace(target)
        return self._reply(201, {"ok": True, "stored": True})

    def do_GET(self) -> None:
        account = self._account()
        if account is None:
            return self._reply(401, {"error": "Unknown or missing bearer token."})
        route = self._route()
        if route is None:
            return self._reply(404, {"error": "No such route."})
        world, kind, name = route
        directory = ROOT / account / world / kind

        if not name:
            if not directory.exists():
                return self._reply(200, {"blobs": []} if kind == "blobs" else {"snapshots": []})
            if kind == "blobs":
                return self._reply(200, {"blobs": sorted(p.name for p in directory.iterdir() if DIGEST_RE.match(p.name))})
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
    parser = argparse.ArgumentParser(description="Quiltor backup endpoint (reference implementation).")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    if not _accounts():
        raise SystemExit('Set QUILTOR_BACKUP_TOKENS="account:token[,account2:token2]" before starting.')
    ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Quiltor backup endpoint on http://{args.host}:{args.port}  ->  {ROOT}")
    with Server((args.host, args.port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
