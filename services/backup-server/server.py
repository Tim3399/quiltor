#!/usr/bin/env python3
"""Reference implementation of the Quiltor backup endpoint.

Run it, point a world's backup URL at it, done:

    QUILTOR_BACKUP_OIDC_ISSUER=https://keycloak.example.com/realms/quiltor \
    QUILTOR_BACKUP_OIDC_CLIENT_ID=quiltor-backup-server \
    QUILTOR_BACKUP_OIDC_CLIENT_SECRET=... \
    QUILTOR_BACKUP_PUBLIC_URL=https://backup.example.com \
    python3 services/backup-server/server.py --port 9000

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

This standalone reference service uses only the standard library. It is
deliberately not a dependency of the app -- nothing in the application package
imports this service.
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
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# The protocol validator is the same source file used by the product reader and
# producer. Source checkouts find it here; the container copies the same package
# beneath /app (see Dockerfile), so there is no second server-only interpretation.
_SOURCE_ROOT = Path(__file__).resolve().parents[2] / "src"
if _SOURCE_ROOT.is_dir():
    sys.path.insert(0, str(_SOURCE_ROOT))

from quiltor.application.backup_manifest import (  # noqa: E402
    BackupContractError,
    DIGEST_RE,
    MAX_BLOB_BYTES,
    MAX_MANIFEST_BYTES,
    strict_json_loads,
    validate_manifest,
    verify_blob,
)

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

ROOT = Path(os.environ.get("QUILTOR_BACKUP_ROOT", "./backup-data")).resolve()

# Module globals rather than values re-read at each use, so the test suite can
# point them at a fake issuer the same way it already redirects ROOT.
ISSUER = os.environ.get("QUILTOR_BACKUP_OIDC_ISSUER", "").rstrip("/")
CLIENT_ID = os.environ.get("QUILTOR_BACKUP_OIDC_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("QUILTOR_BACKUP_OIDC_CLIENT_SECRET", "")
REQUIRED_SCOPE = os.environ.get("QUILTOR_BACKUP_OIDC_SCOPE", "quiltor.backup")
PUBLIC_URL = os.environ.get("QUILTOR_BACKUP_PUBLIC_URL", "").rstrip("/")
ALLOW_INSECURE_LOOPBACK = os.environ.get("QUILTOR_BACKUP_OIDC_ALLOW_INSECURE_LOOPBACK", "") == "1"
TRUSTED_ENDPOINT_ORIGINS = tuple(
    value.strip().rstrip("/")
    for value in os.environ.get("QUILTOR_BACKUP_OIDC_TRUSTED_ORIGINS", "").split(",")
    if value.strip()
)

METADATA_PATH = "/.well-known/oauth-protected-resource"

# Introspection costs a round trip to the issuer, so the verdict is cached -- but
# briefly. Preferring introspection over checking a signature locally is what
# makes a revoked token stop working; a long cache would trade that back away.
TOKEN_TTL = 60.0
TOKEN_CACHE_MAX = 512
HTTP_TIMEOUT = 10
MAX_DISCOVERY_BYTES = 1024 * 1024
MAX_INTROSPECTION_BYTES = 64 * 1024

_lock = threading.Lock()
_discovery: dict[str, dict] = {}
_tokens: dict[str, tuple[float, dict]] = {}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def _validate_secure_url(value: str, *, label: str, public: bool = False) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urllib.parse.urlsplit(candidate)
    hostname = (parsed.hostname or "").rstrip(".").lower()
    loopback = hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        not hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.scheme not in {"http", "https"}
    ):
        raise ValueError(f"{label} must be a credential-free HTTP(S) URL.")
    if parsed.scheme != "https" and not (ALLOW_INSECURE_LOOPBACK and loopback):
        raise ValueError(f"{label} must use HTTPS outside explicit loopback development.")
    if public and parsed.query:
        raise ValueError(f"{label} must not contain a query.")
    return candidate


def _origin(value: str) -> tuple[str, str, int]:
    parsed = urllib.parse.urlsplit(value)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.scheme, (parsed.hostname or "").rstrip(".").lower(), port


def _trusted_endpoint(value: object, issuer: str, *, label: str) -> str:
    endpoint = _validate_secure_url(str(value or ""), label=label)
    trusted = {_origin(issuer)}
    for configured in TRUSTED_ENDPOINT_ORIGINS:
        trusted.add(
            _origin(
                _validate_secure_url(
                    configured,
                    label="QUILTOR_BACKUP_OIDC_TRUSTED_ORIGINS entry",
                    public=True,
                )
            )
        )
    if _origin(endpoint) not in trusted:
        raise ValueError(f"{label} is not on a trusted OIDC origin.")
    return endpoint


def validate_configuration() -> None:
    issuer = _validate_secure_url(ISSUER, label="QUILTOR_BACKUP_OIDC_ISSUER", public=True)
    public_url = _validate_secure_url(PUBLIC_URL, label="QUILTOR_BACKUP_PUBLIC_URL", public=True)
    if not CLIENT_ID.strip() or not CLIENT_SECRET or not REQUIRED_SCOPE.strip():
        raise ValueError("Backup OIDC client, secret, and required scope must not be empty.")
    # Validate optional origins before a real bearer credential is handled.
    for origin in TRUSTED_ENDPOINT_ORIGINS:
        _trusted_endpoint(origin, issuer, label="trusted OIDC origin")
    if urllib.parse.urlsplit(public_url).path.endswith(METADATA_PATH):
        raise ValueError("QUILTOR_BACKUP_PUBLIC_URL must be the service base URL.")


def _safe_storage_path(*parts: str) -> Path:
    """Resolve a store path without accepting symlink/reparse escapes."""

    target = ROOT.joinpath(*parts)
    try:
        target.resolve(strict=False).relative_to(ROOT.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise BackupContractError(
            "unsafe_backup_destination", "Backup destination failed safety checks."
        ) from exc
    for component in (target, *target.parents):
        if component == ROOT.parent:
            break
        try:
            if component.is_symlink():
                raise BackupContractError(
                    "unsafe_backup_destination", "Backup destination failed safety checks."
                )
        except OSError as exc:
            raise BackupContractError(
                "unsafe_backup_destination", "Backup destination failed safety checks."
            ) from exc
    return target


def _read_file_limited(path: Path, maximum: int) -> bytes:
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > maximum:
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            )
        payload = path.read_bytes()
    except BackupContractError:
        raise
    except OSError as exc:
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        ) from exc
    if len(payload) > maximum:
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        )
    return payload


def _atomic_write(target: Path, payload: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    _safe_storage_path(*target.relative_to(ROOT).parts)
    descriptor, staged_name = tempfile.mkstemp(prefix=".quiltor-upload-", dir=target.parent)
    staged = Path(staged_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        staged.replace(target)
    finally:
        try:
            staged.unlink()
        except FileNotFoundError:
            pass


def _read_json_response(request: urllib.request.Request | str, maximum: int) -> dict:
    opener = urllib.request.build_opener(
        _NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    with opener.open(request, timeout=HTTP_TIMEOUT) as response:
        payload = response.read(maximum + 1)
    if len(payload) > maximum:
        raise ValueError("OIDC response exceeds its size limit.")
    document = json.loads(payload.decode("utf-8"))
    if not isinstance(document, dict):
        raise ValueError("OIDC response must be a JSON object.")
    return document


def _get_json(url: str) -> dict:
    _validate_secure_url(url, label="OIDC metadata endpoint")
    return _read_json_response(url, MAX_DISCOVERY_BYTES)


def _post_form(url: str, fields: dict[str, str]) -> dict:
    body = urllib.parse.urlencode(fields).encode("ascii")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    # Certificate-verified, bounded, and redirect-free: this call carries both a
    # user's bearer token and this server's own client secret.
    return _read_json_response(request, MAX_INTROSPECTION_BYTES)


def discover() -> dict:
    """The issuer's OpenID configuration, fetched once and kept."""
    issuer = _validate_secure_url(ISSUER, label="QUILTOR_BACKUP_OIDC_ISSUER", public=True)
    with _lock:
        cached = _discovery.get(issuer)
    if cached is not None:
        return cached
    document = _get_json(f"{issuer}/.well-known/openid-configuration")
    if document.get("issuer") != issuer:
        raise ValueError("OIDC discovery issuer does not match the configured issuer.")
    validated = dict(document)
    validated["introspection_endpoint"] = _trusted_endpoint(
        document.get("introspection_endpoint"),
        issuer,
        label="OIDC introspection endpoint",
    )
    with _lock:
        _discovery[issuer] = validated
    return validated


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
    if type(result.get("active")) is not bool:
        return None
    reported_issuer = result.get("iss")
    if reported_issuer is not None and reported_issuer != ISSUER:
        return None
    expires_at = now + TOKEN_TTL
    reported_expiry = result.get("exp")
    if reported_expiry is not None:
        if type(reported_expiry) not in {int, float} or reported_expiry <= now:
            return None
        expires_at = min(expires_at, float(reported_expiry))
    with _lock:
        if len(_tokens) >= TOKEN_CACHE_MAX:
            for stale in [k for k, (expires, _) in _tokens.items() if expires <= now]:
                _tokens.pop(stale, None)
            if len(_tokens) >= TOKEN_CACHE_MAX:
                _tokens.pop(next(iter(_tokens)), None)
        _tokens[key] = (expires_at, result)
    return result


def _scopes(claims: dict) -> set[str]:
    scope = claims.get("scope") or claims.get("scp") or ""
    if isinstance(scope, str):
        return set(scope.split())
    if isinstance(scope, (list, tuple)) and all(isinstance(item, str) for item in scope):
        return set(scope)
    return set()


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
        if not NAME_RE.fullmatch(subject) or subject in {".", ".."}:
            self._reply(403, {"error": "Token subject is not a usable account key."})
            return None
        return subject

    def _world_index(self, account: str) -> list[dict]:
        """One entry per world this account has backups for, newest activity
        first. Titles come from the manifests themselves (see the "title" field
        written by src/quiltor/infrastructure/backup/snapshots.py), which is what lets a fresh
        install show world names instead of directory ids."""
        root = _safe_storage_path(account)
        found = []
        for world_dir in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
            manifests = []
            if world_dir.is_symlink() or not NAME_RE.fullmatch(world_dir.name):
                continue
            for path in (world_dir / "snapshots").glob("*.json"):
                try:
                    payload = _read_file_limited(path, MAX_MANIFEST_BYTES)
                    parsed = strict_json_loads(payload, maximum_bytes=MAX_MANIFEST_BYTES)
                    manifests.append(
                        validate_manifest(parsed, expected_world=world_dir.name).document
                    )
                except BackupContractError:
                    manifests = []
                    break
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
        if (
            not NAME_RE.fullmatch(world)
            or world in {".", ".."}
            or kind not in ("blobs", "snapshots")
        ):
            return None
        if name and not DIGEST_RE.fullmatch(name):
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

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._reply(400, {"error": "Invalid request payload."})
        maximum = MAX_BLOB_BYTES if kind == "blobs" else MAX_MANIFEST_BYTES
        if length < 0 or length > maximum:
            return self._reply(413, {"error": "Payload too large."})
        payload = self.rfile.read(length)
        if len(payload) != length:
            return self._reply(400, {"error": "Invalid request payload."})

        try:
            target = _safe_storage_path(
                account, world, kind, name if kind == "blobs" else f"{name}.json"
            )
            if kind == "blobs":
                if hashlib.sha256(payload).hexdigest() != name:
                    return self._reply(400, {"error": "Blob failed integrity verification."})
                if target.exists():
                    existing = _read_file_limited(target, MAX_BLOB_BYTES)
                    if hashlib.sha256(existing).hexdigest() != name:
                        return self._reply(500, {"error": "Stored backup content is corrupt."})
                    return self._reply(200, {"ok": True, "stored": False})
            else:
                parsed = strict_json_loads(payload, maximum_bytes=MAX_MANIFEST_BYTES)
                manifest = validate_manifest(parsed, expected_world=world, expected_id=name)
                for record in manifest.files:
                    blob = _safe_storage_path(account, world, "blobs", record.digest)
                    verify_blob(record, _read_file_limited(blob, record.maximum_size))
            _atomic_write(target, payload)
        except BackupContractError:
            return self._reply(400, {"error": "Backup payload failed validation."})
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
        try:
            directory = _safe_storage_path(account, world, kind)
        except BackupContractError:
            return self._reply(400, {"error": "Backup request failed validation."})

        if not name:
            if not directory.exists():
                return self._reply(200, {"blobs": []} if kind == "blobs" else {"snapshots": []})
            if kind == "blobs":
                return self._reply(
                    200,
                    {
                        "blobs": sorted(
                            p.name
                            for p in directory.iterdir()
                            if p.is_file() and not p.is_symlink() and DIGEST_RE.fullmatch(p.name)
                        )
                    },
                )
            manifests = []
            for path in sorted(directory.glob("*.json")):
                try:
                    payload = _read_file_limited(path, MAX_MANIFEST_BYTES)
                    parsed = strict_json_loads(payload, maximum_bytes=MAX_MANIFEST_BYTES)
                    manifests.append(validate_manifest(parsed, expected_world=world).document)
                except BackupContractError:
                    return self._reply(500, {"error": "Stored backup manifest is corrupt."})
            manifests.sort(key=lambda m: m.get("created", ""))
            return self._reply(200, {"snapshots": manifests})

        try:
            target = _safe_storage_path(
                account, world, kind, name if kind == "blobs" else f"{name}.json"
            )
        except BackupContractError:
            return self._reply(400, {"error": "Backup request failed validation."})
        if not target.exists():
            return self._reply(404, {"error": "Not found."})
        try:
            maximum = MAX_BLOB_BYTES if kind == "blobs" else MAX_MANIFEST_BYTES
            payload = _read_file_limited(target, maximum)
            if kind == "blobs":
                if hashlib.sha256(payload).hexdigest() != name:
                    raise BackupContractError(
                        "backup_content_integrity", "Backup content failed integrity verification."
                    )
            else:
                parsed = strict_json_loads(payload, maximum_bytes=MAX_MANIFEST_BYTES)
                validate_manifest(parsed, expected_world=world, expected_id=name)
        except BackupContractError:
            return self._reply(500, {"error": "Stored backup content is corrupt."})
        content_type = "application/octet-stream" if kind == "blobs" else "application/json"
        return self._reply(200, payload, content_type)

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
    try:
        validate_configuration()
    except ValueError as error:
        raise SystemExit(f"Invalid backup-server configuration: {error}") from error
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
