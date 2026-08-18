"""Uploads snapshots to a configurable HTTP backup endpoint.

The protocol is deliberately small enough to reimplement in an afternoon, because
"point Quiltor at your own server" is only a real option if writing that server is
easy. deploy/backup-server/ is a working reference implementation of exactly this.

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

Authentication is a bearer token. Where that token comes from is deliberately
not decided here: TOKEN_SOURCE below is a hook the host replaces at startup, so
a self-hosted endpoint keeps working with a token pasted into the environment
while the hosted build hands over an OIDC access token obtained through a
browser login. Core stays ignorant of which of the two it is talking to.

    GET    {base}/.well-known/oauth-protected-resource   which issuer guards this

...is the one request that carries no token, and it is what makes that login
discoverable: a client configured with nothing but the backup URL reads the
issuer off the endpoint instead of being configured a second time (RFC 9728).

Standard library only.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

TIMEOUT_METADATA = 15
TIMEOUT_BLOB = 120

#: Where an endpoint publishes which issuer it trusts (RFC 9728).
METADATA_PATH = "/.well-known/oauth-protected-resource"


def _token_from_environment(base_url: str) -> str:
    return os.environ.get("QUILTOR_BACKUP_TOKEN", "")


#: How a bearer token for `base_url` is obtained. The host replaces this at
#: startup with the OIDC-backed source; core must not know that one exists.
#: Same move as `read_blob` being passed into push() and as server.RENDER_PDF:
#: the capability is handed in, so this module keeps describing the protocol and
#: nothing else.
TOKEN_SOURCE = _token_from_environment


def resource_metadata(base_url: str) -> dict[str, Any]:
    """The endpoint's protected-resource metadata, or {} if there is none.

    Empty rather than raising, because every reading of a failure here belongs
    to the caller: an endpoint with a hand-issued token legitimately publishes
    no such document, an unreachable one is a connection problem, and deciding
    between those is not this function's business.

    This is the one request that never carries a token -- it is the document a
    client reads *before* it has one, and asking TOKEN_SOURCE for a token here
    would call straight back into the login that is trying to read it.
    """
    request = urllib.request.Request(f"{base_url.rstrip('/')}{METADATA_PATH}", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_METADATA) as response:
            parsed = json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def default_endpoint() -> str:
    """The account-wide backup endpoint. A world may override it with its own,
    but discovery and restore start here, because a machine with no worlds yet
    has no per-world setting to read."""
    return os.environ.get("QUILTOR_BACKUP_URL", "").rstrip("/")


def _request(
    method: str, base: str, path: str, payload: bytes | None, content_type: str, timeout: int
) -> bytes:
    """One request against the endpoint at `base`.

    Base and path are two arguments rather than one finished URL because the
    token belongs to the *endpoint*, not to the URL: TOKEN_SOURCE has to be told
    which backup service is being addressed before it can hand back that
    service's credential. Taking a full URL and splitting the base back out of
    it here would be guesswork -- an endpoint may well live under a path prefix
    -- and guessing wrong means sending one service's token to another.
    """
    base = base.rstrip("/")
    url = f"{base}{path}"
    request = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        request.add_header("Content-Type", content_type)
    token = TOKEN_SOURCE(base)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"Backup endpoint returned {exc.code} for {method} {url}: {detail or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Backup endpoint at {url} is unreachable: {exc.reason}") from exc


def _base(ctx: Any) -> str:
    return ctx.endpoint_url.rstrip("/")


def push(ctx: Any, entry: dict[str, Any], read_blob: Callable[[str], bytes]) -> None:
    """Upload one snapshot and every blob it references.

    `read_blob` is passed in rather than imported so this module never needs to
    know how the local store lays its blobs out on disk.
    """
    world = ctx.root.name
    base = _base(ctx)
    # Ask first: on a re-push, or after an interrupted one, most blobs are already
    # there and re-uploading a multi-megabyte database every time would make
    # backups needlessly expensive over a slow connection.
    present = set(existing_blobs(ctx))
    for digest in sorted(set(entry["files"].values())):
        if digest in present:
            continue
        _request(
            "PUT",
            base,
            f"/v1/worlds/{world}/blobs/{digest}",
            read_blob(digest),
            "application/octet-stream",
            TIMEOUT_BLOB,
        )
    _request(
        "PUT",
        base,
        f"/v1/worlds/{world}/snapshots/{entry['id']}",
        json.dumps(entry, ensure_ascii=False).encode("utf-8"),
        "application/json",
        TIMEOUT_METADATA,
    )


def existing_blobs(ctx: Any) -> list[str]:
    """Digests the endpoint already holds. A server that does not implement the
    hint returns nothing and every blob is simply re-sent -- correct, just slower."""
    world = ctx.root.name
    try:
        body = _request("GET", _base(ctx), f"/v1/worlds/{world}/blobs", None, "", TIMEOUT_METADATA)
    except RuntimeError:
        return []
    try:
        parsed = json.loads(body)
    except ValueError:
        return []
    return [str(item) for item in parsed.get("blobs", [])] if isinstance(parsed, dict) else []


def worlds(base_url: str) -> list[dict[str, Any]]:
    """Worlds the endpoint holds backups for, newest activity first.

    Takes a bare URL rather than a BackupContext: the caller restoring onto an
    empty machine has no world, and therefore no context, yet.
    """
    body = _request("GET", base_url, "/v1/worlds", None, "", TIMEOUT_METADATA)
    parsed = json.loads(body)
    return list(parsed.get("worlds", [])) if isinstance(parsed, dict) else []


def snapshots(ctx: Any) -> list[dict[str, Any]]:
    """Manifests stored at the endpoint, oldest first. Used to restore a world
    onto a machine whose local history is empty."""
    body = _request(
        "GET", _base(ctx), f"/v1/worlds/{ctx.root.name}/snapshots", None, "", TIMEOUT_METADATA
    )
    parsed = json.loads(body)
    return list(parsed.get("snapshots", [])) if isinstance(parsed, dict) else []


def fetch_blob(ctx: Any, digest: str) -> bytes:
    return _request(
        "GET", _base(ctx), f"/v1/worlds/{ctx.root.name}/blobs/{digest}", None, "", TIMEOUT_BLOB
    )
