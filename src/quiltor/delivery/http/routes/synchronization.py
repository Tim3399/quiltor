"""HTTP boundary for explicit, per-world cloud synchronization."""

from __future__ import annotations

from quiltor.application import ApplicationError, encode_document_v1
from quiltor.application.synchronization import (
    SyncGatewayFailure,
    SyncRequestInvalid,
    SyncTargetInvalid,
)
from quiltor.delivery.http.routes import Request, get, save


def _authorization(app, request: Request):
    return app.backup_authorization(request.world.backup.endpoint_url, request.session)


def _send_failure(handler, error: SyncGatewayFailure) -> None:
    params = dict(error.params)
    handler.send_json(
        {
            "ok": False,
            "error": {
                "code": error.code,
                "retryable": error.status not in {401, 403, 507},
                **({"params": params} if params else {}),
            },
        },
        error.status,
    )


def _target(app, world_url: str) -> dict:
    """The world's sync target and where it comes from.

    Precedence (F-87-4): the world's own address wins, the operator's
    QUILTOR_BACKUP_URL is only the fallback for a world without one. That is how
    the backup context has always resolved it (`BackupContext.endpoint_url`), and
    it keeps the address field when creating a world meaningful. The operator's
    value itself cannot be changed from here; a world can only stop overriding it.
    """
    try:
        operator = app.default_endpoint()
    except RuntimeError:
        # An unsafe QUILTOR_BACKUP_URL is no target at all; the sync routes refuse it too.
        operator = ""
    if world_url:
        source, effective = "world", world_url
    elif operator:
        source, effective = "operator", operator
    else:
        source, effective = "none", ""
    return {
        "ok": True,
        "backupUrl": effective,
        "source": source,
        "worldUrl": world_url,
        "operatorUrl": operator,
    }


@get("/api/sync/target", world=True, device_sync=True)
def sync_target(handler, request: Request, app) -> None:
    with app.lock:
        opened = app.worlds.open(request.world.id, request.session.sub)
    handler.send_json(_target(app, opened.summary.backup_url))


@save("/api/sync/target", world=True, device_sync=True)
def set_sync_target(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception as exc:
        return handler.send_exception(exc)
    if getattr(request.world, "preview", False):
        return handler.send_api_error(409, error_code="world.preview", retryable=False)
    value = payload.get("backupUrl") if isinstance(payload, dict) else None
    if not isinstance(value, str) or len(value) > 2048:
        return handler.send_exception(SyncRequestInvalid(params={"field": "backupUrl"}))
    try:
        with app.lock:
            stored = app.worlds.set_backup_url(request.world.id, value)
    except ValueError:
        return handler.send_exception(SyncTargetInvalid(params={"field": "backupUrl"}))
    handler.send_json(_target(app, stored))


@get("/api/sync", world=True, device_sync=True)
def sync_status(handler, request: Request, app) -> None:
    context = request.world.backup
    if not context.endpoint_url:
        with app.lock:
            local = app.synchronization.fingerprint(context)
        return handler.send_json(
            {
                "ok": True,
                "configured": False,
                "endpoint": "",
                "mode": "manual",
                "state": "unconfigured",
                "localFingerprint": local,
                "baseGeneration": None,
                "remote": {"generation": 0, "snapshotId": None},
                "lastSyncedAt": None,
            }
        )
    try:
        authorization = _authorization(app, request)
        result = app.synchronization.status(
            context, request.session.sub, authorization, local_lock=app.lock
        )
        handler.send_json(result)
    except SyncGatewayFailure as exc:
        _send_failure(handler, exc)
    except ApplicationError as exc:
        handler.send_exception(exc)
    except (PermissionError, RuntimeError):
        _send_failure(handler, SyncGatewayFailure("sync.authorization_unavailable", status=403))


@get("/api/sync/preview", world=True, device_sync=True)
def sync_preview(handler, request: Request, app) -> None:
    if not request.world.backup.endpoint_url:
        return _send_failure(handler, SyncGatewayFailure("sync.unconfigured", status=409))
    try:
        authorization = _authorization(app, request)
        result = app.synchronization.preview(
            request.world.backup, request.session.sub, authorization
        )
        with app.lock:
            result["documents"] = {
                kind: encode_document_v1(kind, document)
                for kind, document in result["documents"].items()
            }
        handler.send_json(result)
    except SyncGatewayFailure as exc:
        _send_failure(handler, exc)
    except ApplicationError as exc:
        handler.send_exception(exc)
    except (PermissionError, RuntimeError):
        _send_failure(handler, SyncGatewayFailure("sync.authorization_unavailable", status=403))


@save("/api/sync", device_sync=True)
def synchronize(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:
        # Broad on purpose: a missing, truncated or non-JSON body can raise anything the
        # body reader raises, and none of it needs its own response here. An empty payload
        # carries no "action", so the request is rejected below with sync.request_invalid
        # (or sync.unconfigured / the world lookup first) -- the caller still gets an
        # answer and nothing is swallowed silently.
        payload = {}
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    if getattr(world, "preview", False):
        # A preview of the example world is never synchronised (T-214-5a).
        return handler.send_api_error(409, error_code="world.preview", retryable=False)
    if not world.backup.endpoint_url:
        return _send_failure(handler, SyncGatewayFailure("sync.unconfigured", status=409))
    action = payload.get("action")
    if not isinstance(action, str):
        return handler.send_exception(SyncRequestInvalid(params={"field": "action"}))
    expected_generation = payload.get("expectedGeneration")
    expected_fingerprint = payload.get("expectedLocalFingerprint", "")
    if not isinstance(expected_fingerprint, str):
        return handler.send_exception(
            SyncRequestInvalid(params={"field": "expectedLocalFingerprint"})
        )
    try:
        authorization = app.backup_authorization(world.backup.endpoint_url, request.session)
        result = app.synchronization.synchronize(
            world.backup,
            request.session.sub,
            authorization,
            action,
            expected_generation=expected_generation,
            expected_local_fingerprint=expected_fingerprint,
            local_lock=app.lock,
        )
        action_fields = {"reloadRequired", "localSnapshotId", "warnings"}
        response = {
            "ok": True,
            "status": {key: value for key, value in result.items() if key not in action_fields},
            "reloadRequired": bool(result.get("reloadRequired")),
        }
        if "localSnapshotId" in result:
            response["localSnapshotId"] = result["localSnapshotId"]
        if "warnings" in result:
            response["warnings"] = result["warnings"]
        handler.send_json(response)
    except SyncGatewayFailure as exc:
        _send_failure(handler, exc)
    except ApplicationError as exc:
        handler.send_exception(exc)
    except (PermissionError, RuntimeError):
        _send_failure(handler, SyncGatewayFailure("sync.authorization_unavailable", status=403))


__all__ = ["sync_preview", "sync_status", "synchronize"]
