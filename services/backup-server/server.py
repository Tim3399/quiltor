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
import contextlib
import datetime
import hashlib
import http.server
import json
import os
import re
import socketserver
import ssl
import stat
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
# In the container the file sits flat at /app/server.py and has no third
# ancestor, so only a checkout deep enough to have one looks for a sibling src/.
_HERE = Path(__file__).resolve()
_SOURCE_ROOT = _HERE.parents[2] / "src" if len(_HERE.parents) > 2 else None
if _SOURCE_ROOT is not None and _SOURCE_ROOT.is_dir():
    sys.path.insert(0, str(_SOURCE_ROOT))

from quiltor.application.backup_manifest import (
    DIGEST_RE,
    MAX_BLOB_BYTES,
    MAX_MANIFEST_BYTES,
    BackupContractError,
    strict_json_loads,
    validate_manifest,
    verify_blob,
)

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ACCESS_VALUES = frozenset({"read-write", "read-only"})
MAX_SYNC_BYTES = 1024
MAX_PURGE_ENTRIES = 1_000_000
MAX_GENERATION = 9_007_199_254_740_991

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
POLICY_FILE = os.environ.get("QUILTOR_BACKUP_POLICY_FILE", "").strip()
POLICIES: dict[str, dict] = {}

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
_account_locks: dict[str, threading.RLock] = {}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
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
    load_policy_configuration()


def _utc_timestamp(value: object) -> float:
    if type(value) is not str or not value.endswith(("Z", "+00:00")):
        raise ValueError("deleteAfter must be an ISO 8601 UTC timestamp.")
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("deleteAfter must be an ISO 8601 UTC timestamp.") from exc
    if parsed.tzinfo != datetime.UTC:
        raise ValueError("deleteAfter must be an ISO 8601 UTC timestamp.")
    return parsed.timestamp()


def load_policy_configuration() -> None:
    """Load the operator-owned account policy, rejecting ambiguous configuration."""

    global POLICIES
    if not POLICY_FILE:
        POLICIES = {}
        return
    path = Path(POLICY_FILE)
    try:
        payload = path.read_bytes()
        document = strict_json_loads(payload, maximum_bytes=1024 * 1024)
    except (OSError, BackupContractError) as exc:
        raise ValueError("QUILTOR_BACKUP_POLICY_FILE is not readable valid JSON.") from exc
    if type(document) is not dict or frozenset(document) != {"accounts"}:
        raise ValueError("Backup policy must contain only an accounts object.")
    accounts = document["accounts"]
    if type(accounts) is not dict:
        raise ValueError("Backup policy accounts must be an object.")
    validated: dict[str, dict] = {}
    allowed_fields = frozenset({"access", "limitBytes", "deleteAfter"})
    for subject, entry in accounts.items():
        if (
            type(subject) is not str
            or not NAME_RE.fullmatch(subject)
            or subject in {".", ".."}
            or type(entry) is not dict
            or not frozenset(entry).issubset(allowed_fields)
        ):
            raise ValueError("Backup policy contains an invalid account entry.")
        access = entry.get("access", "read-write")
        limit = entry.get("limitBytes")
        delete_after = entry.get("deleteAfter")
        if type(access) is not str or access not in ACCESS_VALUES:
            raise ValueError("Backup policy access must be read-write or read-only.")
        if limit is not None and (type(limit) is not int or limit < 0):
            raise ValueError("Backup policy limitBytes must be a nonnegative integer or null.")
        if delete_after is not None:
            _utc_timestamp(delete_after)
        validated[subject] = {
            "access": access,
            "limitBytes": limit,
            "deleteAfter": delete_after,
        }
    POLICIES = validated


def _account_policy(account: str) -> dict:
    return POLICIES.get(
        account,
        {"access": "read-write", "limitBytes": None, "deleteAfter": None},
    )


def _account_lock(account: str) -> threading.RLock:
    with _lock:
        return _account_locks.setdefault(account, threading.RLock())


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
            if component.is_symlink() or (
                hasattr(component, "is_junction") and component.is_junction()
            ):
                raise BackupContractError(
                    "unsafe_backup_destination", "Backup destination failed safety checks."
                )
        except OSError as exc:
            raise BackupContractError(
                "unsafe_backup_destination", "Backup destination failed safety checks."
            ) from exc
    return target


def _account_usage(account: str) -> int:
    root = _safe_storage_path(account)
    if not root.exists():
        return 0
    total = 0
    for directory, names, files in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        if directory_path.is_symlink() or (
            hasattr(directory_path, "is_junction") and directory_path.is_junction()
        ):
            raise BackupContractError(
                "unsafe_backup_destination", "Backup destination failed safety checks."
            )
        for name in (*names, *files):
            path = directory_path / name
            if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                raise BackupContractError(
                    "unsafe_backup_destination", "Backup destination failed safety checks."
                )
        for name in files:
            path = directory_path / name
            try:
                total += path.stat().st_size
            except OSError as exc:
                raise BackupContractError(
                    "backup_content_integrity", "Backup content failed integrity verification."
                ) from exc
    return total


def _quota_allows(account: str, target: Path, payload: bytes) -> bool:
    limit = _account_policy(account)["limitBytes"]
    if limit is None:
        return True
    previous = target.stat().st_size if target.exists() else 0
    return _account_usage(account) - previous + len(payload) <= limit


def _head(account: str, world: str) -> dict:
    target = _safe_storage_path(account, world, "sync.json")
    if not target.exists():
        return {"generation": 0, "snapshotId": None}
    payload = _read_file_limited(target, MAX_SYNC_BYTES)
    try:
        document = strict_json_loads(payload, maximum_bytes=MAX_SYNC_BYTES)
    except BackupContractError as exc:
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        ) from exc
    if (
        type(document) is not dict
        or frozenset(document) != {"generation", "snapshotId"}
        or type(document["generation"]) is not int
        or document["generation"] < 0
        or document["generation"] > MAX_GENERATION
        or (
            document["snapshotId"] is not None
            and (
                type(document["snapshotId"]) is not str
                or not DIGEST_RE.fullmatch(document["snapshotId"])
            )
        )
        or (document["generation"] == 0) != (document["snapshotId"] is None)
    ):
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        )
    return document


def _verify_stored_snapshot(account: str, world: str, snapshot_id: str) -> None:
    path = _safe_storage_path(account, world, "snapshots", f"{snapshot_id}.json")
    payload = _read_file_limited(path, MAX_MANIFEST_BYTES)
    parsed = strict_json_loads(payload, maximum_bytes=MAX_MANIFEST_BYTES)
    manifest = validate_manifest(parsed, expected_world=world, expected_id=snapshot_id)
    for record in manifest.files:
        blob = _safe_storage_path(account, world, "blobs", record.digest)
        verify_blob(record, _read_file_limited(blob, record.maximum_size))


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
        raise ValueError("OIDC response must be a JSON object.")  # noqa: TRY004
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
        delete_after = _account_policy(subject)["deleteAfter"]
        if delete_after is not None and time.time() >= _utc_timestamp(delete_after):
            self._reply(
                403,
                {"code": "cloud.account_expired", "error": "Account access has expired."},
            )
            return None
        return subject

    def _write_allowed(self, account: str) -> bool:
        policy = _account_policy(account)
        delete_after = policy["deleteAfter"]
        if delete_after is not None and time.time() >= _utc_timestamp(delete_after):
            self._reply(
                403,
                {"code": "cloud.account_expired", "error": "Account access has expired."},
            )
            return False
        if policy["access"] == "read-only":
            self._reply(
                403,
                {"code": "cloud.read_only", "error": "Account is read-only."},
            )
            return False
        return True

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
        parts = urllib.parse.urlsplit(self.path).path.split("/")
        if len(parts) not in {5, 6} or parts[:3] != ["", "v1", "worlds"]:
            return None
        world, kind = parts[3], parts[4]
        name = parts[5] if len(parts) == 6 else ""
        if (
            not NAME_RE.fullmatch(world)
            or world in {".", ".."}
            or kind not in ("blobs", "snapshots")
        ):
            return None
        if name and not DIGEST_RE.fullmatch(name):
            return None
        return world, kind, name

    def _sync_world(self) -> str | None:
        parts = urllib.parse.urlsplit(self.path).path.split("/")
        if (
            len(parts) != 5
            or parts[:3] != ["", "v1", "worlds"]
            or parts[4] != "sync"
            or not NAME_RE.fullmatch(parts[3])
            or parts[3] in {".", ".."}
        ):
            return None
        return parts[3]

    def do_PUT(self) -> None:
        account = self._account()
        if account is None:
            return  # _account already wrote the 401 or 403
        if not self._write_allowed(account):
            return
        sync_world = self._sync_world()
        route = self._route()
        if route is None and sync_world is None:
            return self._reply(404, {"error": "No such route."})
        if route is not None and not route[2]:
            return self._reply(405, {"error": "PUT requires a blob digest or snapshot id."})

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._reply(400, {"error": "Invalid request payload."})
        maximum = (
            MAX_SYNC_BYTES
            if sync_world is not None
            else MAX_BLOB_BYTES
            if route[1] == "blobs"
            else MAX_MANIFEST_BYTES
        )
        if length < 0 or length > maximum:
            return self._reply(413, {"error": "Payload too large."})
        payload = self.rfile.read(length)
        if len(payload) != length:
            return self._reply(400, {"error": "Invalid request payload."})

        with _account_lock(account):
            if not self._write_allowed(account):
                return
            try:
                if sync_world is not None:
                    return self._put_sync(account, sync_world, payload)
                world, kind, name = route
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
                    if target.exists():
                        _verify_stored_snapshot(account, world, name)
                        return self._reply(200, {"ok": True, "stored": False})
                if not _quota_allows(account, target, payload):
                    return self._reply(
                        507,
                        {"code": "cloud.quota_exceeded", "error": "Account quota exceeded."},
                    )
                _atomic_write(target, payload)
            except BackupContractError:
                return self._reply(400, {"error": "Backup payload failed validation."})
        return self._reply(201, {"ok": True, "stored": True})

    def _put_sync(self, account: str, world: str, payload: bytes) -> None:
        try:
            request = strict_json_loads(payload, maximum_bytes=MAX_SYNC_BYTES)
        except BackupContractError:
            return self._reply(400, {"error": "Sync head request failed validation."})
        if (
            type(request) is not dict
            or frozenset(request) != {"expectedGeneration", "snapshotId"}
            or type(request["expectedGeneration"]) is not int
            or request["expectedGeneration"] < 0
            or request["expectedGeneration"] > MAX_GENERATION
            or type(request["snapshotId"]) is not str
            or not DIGEST_RE.fullmatch(request["snapshotId"])
        ):
            return self._reply(400, {"error": "Sync head request failed validation."})
        try:
            current = _head(account, world)
            if current["snapshotId"] == request["snapshotId"]:
                _verify_stored_snapshot(account, world, request["snapshotId"])
                return self._reply(200, current)
            if current["generation"] != request["expectedGeneration"]:
                return self._reply(409, {"code": "sync.conflict", "head": current})
            if current["generation"] == MAX_GENERATION:
                return self._reply(409, {"code": "sync.conflict", "head": current})
            _verify_stored_snapshot(account, world, request["snapshotId"])
            updated = {
                "generation": current["generation"] + 1,
                "snapshotId": request["snapshotId"],
            }
            encoded = json.dumps(updated, separators=(",", ":")).encode("utf-8")
            target = _safe_storage_path(account, world, "sync.json")
            if not _quota_allows(account, target, encoded):
                return self._reply(
                    507,
                    {"code": "cloud.quota_exceeded", "error": "Account quota exceeded."},
                )
            _atomic_write(target, encoded)
        except BackupContractError:
            return self._reply(400, {"error": "Stored snapshot failed validation."})
        return self._reply(200, updated)

    def do_GET(self) -> None:
        # Answered before authentication, and that is the point: this is how a
        # client given nothing but a backup URL learns which issuer to log in to.
        # Publishing it costs nothing -- it names the guard, not the data.
        if self.path.split("?")[0] == METADATA_PATH:
            return self._reply(200, metadata_document())

        account = self._account()
        if account is None:
            return  # _account already wrote the 401 or 403
        path = urllib.parse.urlsplit(self.path).path
        if path == "/v1/account":
            with _account_lock(account):
                try:
                    used = _account_usage(account)
                except BackupContractError:
                    return self._reply(500, {"error": "Stored backup content is unsafe."})
                policy = _account_policy(account)
                return self._reply(
                    200,
                    {
                        "accountId": hashlib.sha256(account.encode("utf-8")).hexdigest(),
                        "access": policy["access"],
                        "usedBytes": used,
                        "limitBytes": policy["limitBytes"],
                        "deleteAfter": policy["deleteAfter"],
                    },
                )
        if path == "/v1/worlds":
            with _account_lock(account):
                return self._reply(200, {"worlds": self._world_index(account)})

        sync_world = self._sync_world()
        if sync_world is not None:
            with _account_lock(account):
                try:
                    return self._reply(200, _head(account, sync_world))
                except BackupContractError:
                    return self._reply(500, {"error": "Stored sync head is corrupt."})

        route = self._route()
        if route is None:
            return self._reply(404, {"error": "No such route."})
        world, kind, name = route
        try:
            directory = _safe_storage_path(account, world, kind)
        except BackupContractError:
            return self._reply(400, {"error": "Backup request failed validation."})

        with _account_lock(account):
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
                                if p.is_file()
                                and not p.is_symlink()
                                and DIGEST_RE.fullmatch(p.name)
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
                            "backup_content_integrity",
                            "Backup content failed integrity verification.",
                        )
                else:
                    payload = _read_file_limited(target, MAX_MANIFEST_BYTES)
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


@contextlib.contextmanager
def _storage_process_lock():
    """Exclude maintenance from a server process using the same storage root."""

    lock_path = _safe_storage_path(".quiltor-storage.lock")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    handle = os.fdopen(descriptor, "r+b", closefd=True)
    try:
        if os.name == "nt":
            import msvcrt

            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise ValueError(
                    "Backup storage is in use; stop the server before maintenance."
                ) from exc
            unlock = lambda: msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise ValueError(
                    "Backup storage is in use; stop the server before maintenance."
                ) from exc
            unlock = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        try:
            yield
        finally:
            handle.seek(0)
            unlock()
    finally:
        handle.close()


def _validate_purge_tree(root: Path) -> None:
    root.resolve(strict=False).relative_to(ROOT.resolve(strict=False))
    count = 0
    for directory, names, files in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        if len(directory_path.relative_to(root).parts) > 4:
            raise ValueError(f"Refusing to purge unexpectedly deep tree: {directory_path}")
        entries = [directory_path, *(directory_path / name for name in (*names, *files))]
        for entry in entries:
            count += 1
            if count > MAX_PURGE_ENTRIES:
                raise ValueError("Refusing to purge an account exceeding the entry limit.")
            entry.resolve(strict=False).relative_to(ROOT.resolve(strict=False))
            if entry.is_symlink() or (hasattr(entry, "is_junction") and entry.is_junction()):
                raise ValueError(f"Refusing to purge linked path: {entry}")


def _remove_quarantined_tree(root: Path) -> None:
    for entry in os.scandir(root):
        info = entry.stat(follow_symlinks=False)
        if entry.is_symlink() or getattr(info, "st_file_attributes", 0) & getattr(
            stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0
        ):
            raise ValueError(f"Refusing to purge linked path: {entry.path}")
        if entry.is_dir(follow_symlinks=False):
            _remove_quarantined_tree(Path(entry.path))
        else:
            os.unlink(entry.path)
    os.rmdir(root)


def purge_expired_accounts(*, dry_run: bool = False) -> list[str]:
    """Quarantine and delete only explicitly expired policy accounts."""

    now = time.time()
    eligible = sorted(
        account
        for account, policy in POLICIES.items()
        if policy["deleteAfter"] is not None and now >= _utc_timestamp(policy["deleteAfter"])
    )
    purged: list[str] = []
    quarantine = _safe_storage_path(".quiltor-expired")
    for account in eligible:
        with _account_lock(account):
            source = _safe_storage_path(account)
            quarantined = []
            if quarantine.exists():
                quarantined = sorted(
                    path
                    for path in quarantine.iterdir()
                    if path.is_dir() and re.fullmatch(rf"{re.escape(account)}-[0-9]+", path.name)
                )
            if not source.exists() and not quarantined:
                continue
            if source.exists():
                _validate_purge_tree(source)
            for retained in quarantined:
                _validate_purge_tree(retained)
            if dry_run:
                purged.append(account)
                continue
            quarantine.mkdir(parents=True, exist_ok=True)
            _safe_storage_path(".quiltor-expired")
            if source.exists():
                destination = _safe_storage_path(".quiltor-expired", f"{account}-{time.time_ns()}")
                source.replace(destination)
                _validate_purge_tree(destination)
                quarantined.append(destination)
            for retained in quarantined:
                _remove_quarantined_tree(retained)
            purged.append(account)
    return purged


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Quiltor backup endpoint (reference implementation)."
    )
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--purge-expired",
        action="store_true",
        help="delete accounts whose operator policy deleteAfter has passed, then exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --purge-expired, list eligible accounts without deleting them",
    )
    args = parser.parse_args()
    if args.dry_run and not args.purge_expired:
        parser.error("--dry-run requires --purge-expired")
    if args.purge_expired:
        try:
            load_policy_configuration()
            ROOT.mkdir(parents=True, exist_ok=True)
            with _storage_process_lock():
                accounts = purge_expired_accounts(dry_run=args.dry_run)
        except (OSError, ValueError, BackupContractError) as error:
            raise SystemExit(f"Expired-account purge refused: {error}") from error
        action = "eligible" if args.dry_run else "purged"
        print(json.dumps({action: accounts}))
        return
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
    try:
        with _storage_process_lock(), Server((args.host, args.port), Handler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nStopped.")
    except ValueError as error:
        raise SystemExit(f"Backup storage lock refused: {error}") from error


if __name__ == "__main__":
    main()
