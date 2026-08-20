"""The local assistant: status, logs, progress, runtime install, jobs, and chat."""

from __future__ import annotations

import uuid
from typing import Any

from backend.api.routes import Request, get, save
from backend.assistant import (
    ASSISTANT_REPLY_LANGUAGES,
    DEFAULT_ASSISTANT_LANGUAGE,
    read_progress,
)
from backend.assistant.jobs import (
    IdempotencyConflict,
    assistant_error_status,
    classify_assistant_error,
)
from backend.core import storage
from backend.core.knowledge import build_knowledge
from backend.llm.installer import (
    install_async,
    is_configured,
    read_install_state,
)


@get("/api/assistant/status", world=True)
def status(handler, request: Request, app) -> None:
    with app._lock:
        manuscript = storage.load_manuscript(request.db_path)
        figures = storage.load_figures(request.db_path)

    # Cheap no-op when already running -- picks up a runtime that finished
    # installing since the process started (or since the last poll) without
    # needing a full server restart.
    app.ASSISTANT.reload()

    handler.send_json(
        {
            "ok": True,
            **app.ASSISTANT.status(),
            "installed": is_configured(),
            "chunks": len(build_knowledge(manuscript, figures)),
        }
    )


@get("/api/assistant/logs", world=True)
def logs(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json(
            {
                "ok": True,
                "interactions": storage.list_assistant_interactions(db_path=request.db_path),
            }
        )


@get("/api/assistant/progress")
def progress(handler, request: Request, app) -> None:
    # No lock: this reads the in-memory progress registry, not SQLite, so it is
    # safe to poll while a batch run is in flight on another thread.
    identifier = request.param("id")
    state = read_progress(identifier) if identifier else None

    handler.send_json(
        {
            "ok": state is not None,
            "progress": state,
        }
    )


@get("/api/assistant/install/status")
def install_status(handler, request: Request, app) -> None:
    # No lock: reads backend/llm/installer.py's own in-memory progress registry.
    handler.send_json(
        {
            "ok": True,
            **read_install_state(),
        }
    )


@save("/api/assistant/install")
def install(handler, request: Request, app) -> None:
    """Start asynchronous local-runtime installation.

    No world scope: the runtime is one shared process-wide resource.
    install_async() guards against a second concurrent install;
    `started=False` just means one was already running, not a failure -- the
    frontend polls /api/assistant/install/status either way.
    """

    handler.send_json(
        {
            "ok": True,
            "started": install_async(),
        }
    )


def _prepare_request(
    handler, request: Request, app
) -> tuple[Any, dict[str, Any], dict[str, Any]] | None:
    """Validate one assistant request and snapshot the world it should reason over."""

    payload = handler._read_json_body()
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return None

    question = str(payload.get("question", "")).strip()
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    chapter_ids = [str(item) for item in payload.get("chapterIds") or [] if isinstance(item, str)][
        :50
    ]
    run_batches = bool(payload.get("runBatches"))
    progress_id = str(payload.get("progressId") or "")[:64] or None
    requested = str(payload.get("language") or "")
    language = requested if requested in ASSISTANT_REPLY_LANGUAGES else DEFAULT_ASSISTANT_LANGUAGE

    if not question or len(question) > 4000:
        raise ValueError("Die Nachricht muss zwischen 1 und 4000 Zeichen lang sein.")

    with app._lock:
        manuscript = storage.load_manuscript(world.db_path)
        figures = storage.load_figures(world.db_path)

    # `intent` defines equality for one idempotency key. progressId is UI
    # correlation and therefore deliberately excluded from the hash.
    intent = {
        "question": question,
        "history": history[-40:],
        "chapterIds": chapter_ids,
        "runBatches": run_batches,
        "language": language,
    }
    execution = {
        **intent,
        "worldId": world.id,
        "progressId": progress_id,
        # A queued job means "the world when Send was pressed", not whatever
        # happens to be in SQLite minutes later when the worker reaches it.
        "manuscript": manuscript,
        "figures": figures,
    }
    return world, intent, execution


def _send_direct_error(handler, exc: Exception) -> None:
    code = 400 if isinstance(exc, (ValueError, TypeError)) else assistant_error_status(exc)
    handler.send_json(
        {
            "ok": False,
            "fehler": str(exc),
            "errorType": classify_assistant_error(exc),
        },
        code,
    )


@save("/api/assistant/jobs")
def create_job(handler, request: Request, app) -> None:
    """Create an idempotent assistant job and return without waiting for the model."""

    try:
        prepared = _prepare_request(handler, request, app)
        if prepared is None:
            return
        world, intent, execution = prepared
        key = (handler.headers.get("Idempotency-Key") or "").strip()
        if not key:
            return handler.send_json(
                {
                    "ok": False,
                    "fehler": "Für Assistant-Jobs ist ein Idempotency-Key erforderlich.",
                    "errorType": "missing_idempotency_key",
                },
                400,
            )

        job, created = app.ASSISTANT_JOBS.submit(
            owner_sub=request.session.sub,
            world_id=world.id,
            idempotency_key=key,
            intent=intent,
            execution=execution,
            progress_id=execution.get("progressId"),
        )
        handler.send_json(
            {
                "ok": True,
                "created": created,
                "job": job,
            },
            202 if created else 200,
        )
    except IdempotencyConflict as exc:
        handler.send_json(
            {
                "ok": False,
                "fehler": str(exc),
                "errorType": "idempotency_conflict",
            },
            409,
        )
    except Exception as exc:
        _send_direct_error(handler, exc)


@get("/api/assistant/job", world=True)
def job_status(handler, request: Request, app) -> None:
    """Read one job through the same world-ownership gate as other world data."""

    job_id = request.param("id")
    if not job_id:
        return handler.send_json({"ok": False, "fehler": "Ungültiger Assistant-Job."}, 400)

    job = app.ASSISTANT_JOBS.get(job_id, request.session.sub, request.world.id)
    if job is None:
        return handler.send_json({"ok": False, "fehler": "Assistant-Job nicht gefunden."}, 404)
    handler.send_json({"ok": True, "job": job})


@save("/api/assistant/job/cancel")
def cancel_job(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        world = handler.world_from_body(request.session, payload)
        if world is None:
            return
        job_id = str(payload.get("id") or "")
        if not job_id:
            raise ValueError("Assistant-Job fehlt.")
        job = app.ASSISTANT_JOBS.cancel(job_id, request.session.sub, world.id)
        if job is None:
            return handler.send_json({"ok": False, "fehler": "Assistant-Job nicht gefunden."}, 404)
        handler.send_json({"ok": True, "job": job})
    except Exception as exc:
        _send_direct_error(handler, exc)


@save("/api/assistant/chat")
def chat(handler, request: Request, app) -> None:
    """Backward-compatible synchronous endpoint backed by the durable queue.

    Current web clients create `/api/assistant/jobs` and poll `/api/assistant/job`.
    Older clients can keep using this endpoint, but they no longer bypass the
    one-inference-at-a-time worker.
    """

    try:
        prepared = _prepare_request(handler, request, app)
        if prepared is None:
            return
        world, intent, execution = prepared
        key = (handler.headers.get("Idempotency-Key") or "").strip() or f"legacy:{uuid.uuid4().hex}"

        job, _ = app.ASSISTANT_JOBS.submit(
            owner_sub=request.session.sub,
            world_id=world.id,
            idempotency_key=key,
            intent=intent,
            execution=execution,
            progress_id=execution.get("progressId"),
        )
        terminal = app.ASSISTANT_JOBS.wait(job["id"], request.session.sub, world.id)

        if terminal["status"] == "completed" and terminal.get("result"):
            return handler.send_json(terminal["result"])
        if terminal["status"] == "cancelled":
            return handler.send_json(
                {
                    "ok": False,
                    "fehler": "Anfrage abgebrochen.",
                    "errorType": "cancelled",
                },
                409,
            )
        return handler.send_json(
            {
                "ok": False,
                "fehler": terminal.get("error") or "Assistant-Anfrage fehlgeschlagen.",
                "errorType": terminal.get("errorType") or "assistant_error",
            },
            int(terminal.get("httpStatus") or 503),
        )
    except IdempotencyConflict as exc:
        handler.send_json(
            {
                "ok": False,
                "fehler": str(exc),
                "errorType": "idempotency_conflict",
            },
            409,
        )
    except Exception as exc:
        _send_direct_error(handler, exc)
