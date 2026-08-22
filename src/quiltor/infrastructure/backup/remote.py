"""Uploads snapshots to a configurable HTTP backup endpoint.

The protocol is deliberately small enough to reimplement in an afternoon, because
"point Quiltor at your own server" is only a real option if writing that server is
easy. services/backup-server/ is a working reference implementation of exactly this.

    GET    {base}/v1/worlds                             worlds held for this account
    PUT    {base}/v1/worlds/{world}/blobs/{sha256}      raw bytes, idempotent
    PUT    {base}/v1/worlds/{world}/snapshots/{id}      the manifest, as JSON
    GET    {base}/v1/worlds/{world}/snapshots           list of manifests
    GET    {base}/v1/worlds/{world}/blobs/{sha256}      raw bytes

The first one is what makes restoring onto a fresh machine possible at all: with
no local worlds there is nothing to read a per-world endpoint from, so discovery
starts from QUILTOR_BACKUP_URL and asks the endpoint what it holds.

Blobs are content-addressed and immutable, so an upload that dies halfway is
resumed simply by running it again: whatever already arrived is already correct,
and re-sending a blob the server has is a no-op. The manifest goes last, so a
snapshot only becomes visible once every blob it names is present -- the server
never holds a manifest pointing at content it does not have.

Authentication is an endpoint-bound bearer capability passed explicitly for
each operation. The transport never reads environment, session, or global token
state and refuses a capability whose canonical endpoint differs from the request.

    GET    {base}/.well-known/oauth-protected-resource   which issuer guards this

...is the one request that carries no token, and it is what makes that login
discoverable: a client configured with nothing but the backup URL reads the
issuer off the endpoint instead of being configured a second time (RFC 9728).

Standard library only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from quiltor.application.backup_manifest import (
    BackupContractError,
    DIGEST_RE,
    MAX_BLOB_BYTES,
    MAX_MANIFEST_BYTES,
    strict_json_loads,
    validate_manifest,
    verify_blob,
)
from quiltor.application.backups import BackupAuthorization

TIMEOUT_METADATA = 15
TIMEOUT_BLOB = 120
MAX_LIST_BYTES = 32 * 1024 * 1024
MAX_METADATA_BYTES = 1024 * 1024

#: Where an endpoint publishes which issuer it trusts (RFC 9728).
METADATA_PATH = "/.well-known/oauth-protected-resource"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never replay a credential to a redirect target.

    Backup endpoints are configured base URLs, not navigation URLs. Requiring the
    caller to configure the final endpoint also prevents urllib from forwarding
    Authorization across origins on an attacker-controlled redirect.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def canonical_endpoint(base_url: str) -> str:
    """Return a transport-safe endpoint identity or fail before networking."""

    if not isinstance(base_url, str) or not base_url or len(base_url) > 2048:
        raise RuntimeError("Backup endpoint is not configured safely.")
    try:
        parsed = urllib.parse.urlsplit(base_url)
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("Backup endpoint is not configured safely.") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Backup endpoint is not configured safely.")
    hostname = parsed.hostname.casefold().rstrip(".")
    loopback = hostname in {"127.0.0.1", "::1", "localhost"}
    if parsed.scheme != "https" and not loopback:
        raise RuntimeError("Backup endpoint requires HTTPS.")
    default_port = 443 if parsed.scheme == "https" else 80
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != default_port:
        authority += f":{port}"
    path = parsed.path.rstrip("/")
    if "\\" in path or any(segment in {".", ".."} for segment in path.split("/")):
        raise RuntimeError("Backup endpoint is not configured safely.")
    return urllib.parse.urlunsplit((parsed.scheme, authority, path, "", ""))


def resource_metadata(base_url: str) -> dict[str, Any]:
    """The endpoint's protected-resource metadata, or {} if there is none.

    Empty rather than raising, because every reading of a failure here belongs
    to the caller: an endpoint with a hand-issued token legitimately publishes
    no such document, an unreachable one is a connection problem, and deciding
    between those is not this function's business.

    This is the one request that never carries a token -- it is the document a
    client reads *before* it has one, and asking for a token here
    would call straight back into the login that is trying to read it.
    """
    try:
        base_url = canonical_endpoint(base_url)
    except RuntimeError:
        return {}
    request = urllib.request.Request(f"{base_url}{METADATA_PATH}", method="GET")
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=TIMEOUT_METADATA) as response:
            content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0]
            if content_type.lower() != "application/json":
                return {}
            body = response.read(MAX_METADATA_BYTES + 1)
            if len(body) > MAX_METADATA_BYTES:
                return {}
            parsed = strict_json_loads(body, maximum_bytes=MAX_METADATA_BYTES)
    except (urllib.error.URLError, OSError, ValueError, BackupContractError):
        return {}
    if type(parsed) is not dict or parsed.get("resource") != base_url:
        return {}
    servers = parsed.get("authorization_servers")
    scopes = parsed.get("scopes_supported", [])
    if (
        type(servers) is not list
        or len(servers) != 1
        or type(servers[0]) is not str
        or type(scopes) is not list
        or len(scopes) > 32
        or not all(type(scope) is str and 0 < len(scope) <= 255 for scope in scopes)
    ):
        return {}
    return parsed


def _request(
    method: str,
    base: str,
    path: str,
    payload: bytes | None,
    content_type: str,
    timeout: int,
    authorization: BackupAuthorization,
) -> bytes:
    """One request against the endpoint at `base`.

    Base and path are two arguments rather than one finished URL because the
    token belongs to the *endpoint*, not to an arbitrary URL. The explicit
    authorization carries the canonical base (including a path prefix), and a
    mismatch fails before a socket is opened.
    """
    base = canonical_endpoint(base)
    if canonical_endpoint(authorization.endpoint) != base:
        raise RuntimeError("Backup authorization does not match the endpoint.")
    url = f"{base}{path}"
    request = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        request.add_header("Content-Type", content_type)
    token = authorization.bearer_token
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    opener = urllib.request.build_opener(_NoRedirect())
    maximum = MAX_BLOB_BYTES if timeout == TIMEOUT_BLOB else MAX_LIST_BYTES
    try:
        with opener.open(request, timeout=timeout) as response:
            body = response.read(maximum + 1)
            if len(body) > maximum:
                raise RuntimeError("Backup endpoint response is too large.")
            return body
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Backup endpoint rejected the request ({exc.code}).") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("Backup endpoint is unreachable.") from exc


def _base(ctx: Any) -> str:
    return canonical_endpoint(ctx.endpoint_url)


def push(
    ctx: Any,
    entry: dict[str, Any],
    read_blob: Callable[[str], bytes],
    authorization: BackupAuthorization,
) -> None:
    """Upload one snapshot and every blob it references.

    `read_blob` is passed in rather than imported so this module never needs to
    know how the local store lays its blobs out on disk.
    """
    world = ctx.root.name
    base = _base(ctx)
    validated = validate_manifest(entry, expected_world=world)
    # Ask first: on a re-push, or after an interrupted one, most blobs are already
    # there and re-uploading a multi-megabyte database every time would make
    # backups needlessly expensive over a slow connection.
    present = set(existing_blobs(ctx, authorization))
    records_by_digest = {record.digest: record for record in validated.files}
    for digest, record in sorted(records_by_digest.items()):
        if digest in present:
            continue
        payload = verify_blob(record, read_blob(digest))
        _request(
            "PUT",
            base,
            f"/v1/worlds/{world}/blobs/{digest}",
            payload,
            "application/octet-stream",
            TIMEOUT_BLOB,
            authorization,
        )
    _request(
        "PUT",
        base,
        f"/v1/worlds/{world}/snapshots/{validated.identifier}",
        json.dumps(validated.document, ensure_ascii=False).encode("utf-8"),
        "application/json",
        TIMEOUT_METADATA,
        authorization,
    )


def existing_blobs(ctx: Any, authorization: BackupAuthorization) -> list[str]:
    """Digests the endpoint already holds. A server that does not implement the
    hint returns nothing and every blob is simply re-sent -- correct, just slower."""
    world = ctx.root.name
    try:
        body = _request(
            "GET",
            _base(ctx),
            f"/v1/worlds/{world}/blobs",
            None,
            "",
            TIMEOUT_METADATA,
            authorization,
        )
    except RuntimeError:
        return []
    try:
        parsed = strict_json_loads(body, maximum_bytes=MAX_LIST_BYTES)
    except BackupContractError:
        return []
    if type(parsed) is not dict or frozenset(parsed) != {"blobs"}:
        return []
    blobs = parsed["blobs"]
    if type(blobs) is not list or len(blobs) > 100_000:
        return []
    return [item for item in blobs if type(item) is str and DIGEST_RE.fullmatch(item)]


def worlds(base_url: str, authorization: BackupAuthorization) -> list[dict[str, Any]]:
    """Worlds the endpoint holds backups for, newest activity first.

    Takes a bare URL rather than a BackupContext: the caller restoring onto an
    empty machine has no world, and therefore no context, yet.
    """
    body = _request("GET", base_url, "/v1/worlds", None, "", TIMEOUT_METADATA, authorization)
    parsed = strict_json_loads(body, maximum_bytes=MAX_LIST_BYTES)
    if (
        type(parsed) is not dict
        or frozenset(parsed) != {"worlds"}
        or type(parsed["worlds"]) is not list
    ):
        raise RuntimeError("Backup endpoint returned an invalid response.")
    return list(parsed["worlds"])


def snapshots(ctx: Any, authorization: BackupAuthorization) -> list[dict[str, Any]]:
    """Manifests stored at the endpoint, oldest first. Used to restore a world
    onto a machine whose local history is empty."""
    body = _request(
        "GET",
        _base(ctx),
        f"/v1/worlds/{ctx.root.name}/snapshots",
        None,
        "",
        TIMEOUT_METADATA,
        authorization,
    )
    parsed = strict_json_loads(body, maximum_bytes=MAX_LIST_BYTES)
    if (
        type(parsed) is not dict
        or frozenset(parsed) != {"snapshots"}
        or type(parsed["snapshots"]) is not list
        or len(parsed["snapshots"]) > 10_000
    ):
        raise BackupContractError("invalid_backup_manifest", "Backup snapshot failed validation.")
    return [
        validate_manifest(entry, expected_world=ctx.root.name).document
        for entry in parsed["snapshots"]
    ]


def fetch_blob(ctx: Any, digest: str, authorization: BackupAuthorization) -> bytes:
    if not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest):
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        )
    return _request(
        "GET",
        _base(ctx),
        f"/v1/worlds/{ctx.root.name}/blobs/{digest}",
        None,
        "",
        TIMEOUT_BLOB,
        authorization,
    )
