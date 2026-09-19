"""HTTP boundary for explicit, per-world cloud synchronization."""

from __future__ import annotations

from quiltor.application import ApplicationError, encode_document_v1
from quiltor.application.synchronization import SyncGatewayFailure, SyncRequestInvalid
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


@get("/api/sync", world=True)
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


@get("/api/sync/preview", world=True)
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


@save("/api/sync")
def synchronize(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:  # noqa: BLE001 - malformed request bodies become validation errors
        payload = {}
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
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
