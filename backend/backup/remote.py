"""Uploads snapshots to a configurable HTTP backup endpoint.

The protocol is deliberately small enough to reimplement in an afternoon, because
"point Quiltor at your own server" is only a real option if writing that server is
easy. deploy/backup-server/ is a working reference implementation of exactly this.

    PUT    {base}/v1/worlds/{world}/blobs/{sha256}      raw bytes, idempotent
    PUT    {base}/v1/worlds/{world}/snapshots/{id}      the manifest, as JSON
    GET    {base}/v1/worlds/{world}/snapshots           list of manifests
    GET    {base}/v1/worlds/{world}/blobs/{sha256}      raw bytes

Blobs are content-addressed and immutable, so an upload that dies halfway is
resumed simply by running it again: whatever already arrived is already correct,
and re-sending a blob the server has is a no-op. The manifest goes last, so a
snapshot only becomes visible once every blob it names is present -- the server
never holds a manifest pointing at content it does not have.

Authentication is a bearer token, which is all a self-hosted endpoint needs and
what a hosted one can hand out per account. Standard library only.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

TIMEOUT_METADATA = 15
TIMEOUT_BLOB = 120


def _token() -> str:
    return os.environ.get("QUILTOR_BACKUP_TOKEN", "")


def _request(method: str, url: str, payload: bytes | None, content_type: str, timeout: int) -> bytes:
    request = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        request.add_header("Content-Type", content_type)
    token = _token()
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Backup endpoint returned {exc.code} for {method} {url}: {detail or exc.reason}") from exc
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
        _request("PUT", f"{base}/v1/worlds/{world}/blobs/{digest}",
                 read_blob(digest), "application/octet-stream", TIMEOUT_BLOB)
    _request("PUT", f"{base}/v1/worlds/{world}/snapshots/{entry['id']}",
             json.dumps(entry, ensure_ascii=False).encode("utf-8"), "application/json", TIMEOUT_METADATA)


def existing_blobs(ctx: Any) -> list[str]:
    """Digests the endpoint already holds. A server that does not implement the
    hint returns nothing and every blob is simply re-sent -- correct, just slower."""
    world = ctx.root.name
    try:
        body = _request("GET", f"{_base(ctx)}/v1/worlds/{world}/blobs", None, "", TIMEOUT_METADATA)
    except RuntimeError:
        return []
    try:
        parsed = json.loads(body)
    except ValueError:
        return []
    return [str(item) for item in parsed.get("blobs", [])] if isinstance(parsed, dict) else []


def snapshots(ctx: Any) -> list[dict[str, Any]]:
    """Manifests stored at the endpoint, oldest first. Used to restore a world
    onto a machine whose local history is empty."""
    body = _request("GET", f"{_base(ctx)}/v1/worlds/{ctx.root.name}/snapshots", None, "", TIMEOUT_METADATA)
    parsed = json.loads(body)
    return list(parsed.get("snapshots", [])) if isinstance(parsed, dict) else []


def fetch_blob(ctx: Any, digest: str) -> bytes:
    return _request("GET", f"{_base(ctx)}/v1/worlds/{ctx.root.name}/blobs/{digest}", None, "", TIMEOUT_BLOB)
