"""The local assistant: status, logs, progress, runtime install, jobs, and chat."""

from __future__ import annotations

from typing import Any

from quiltor.delivery.http.routes import Request, get, save
from quiltor.modules.assistant import (
    ASSISTANT_REPLY_LANGUAGES,
    DEFAULT_ASSISTANT_LANGUAGE,
)
from quiltor.modules.assistant.jobs import IdempotencyConflict


@get("/api/assistant/status", world=True)
def status(handler, request: Request, app) -> None:
    with app.lock:
        manuscript, figures = app.documents.load_pair(request.db_path)

    # Cheap no-op when already running -- picks up a runtime that finished
    # installing since the process started (or since the last poll) without
    # needing a full server restart.
    app.assistant.reload()

    handler.send_json(
        {
            "ok": True,
            **app.assistant.status(),
            "installed": app.assistant_installation.is_configured(),
            "chunks": app.story_world.knowledge_chunk_count(manuscript, figures),
        }
    )


@get("/api/assistant/logs", world=True)
def logs(handler, request: Request, app) -> None:
    with app.lock:
        handler.send_json(
            {
                "ok": True,
                "interactions": app.audit.list(request.db_path),
            }
        )


@get("/api/assistant/progress", world=True)
def progress(handler, request: Request, app) -> None:
    identifier = request.param("id")
    state = (
        app.assistant.progress.read(request.session.sub, request.world.id, identifier)
        if identifier
        else None
    )

    handler.send_json(
        {
            # A missing progress record is a valid polling state, not a failed
            # HTTP operation. ``ok`` describes transport/application success;
            # the nullable value describes whether work has begun.
            "ok": True,
            "progress": state,
        }
    )


@get("/api/assistant/install/status")
def install_status(handler, request: Request, app) -> None:
    # No lock: the injected installer owns a thread-safe process-wide progress registry.
    handler.send_json(
        {
            "ok": True,
            **app.assistant_installation.read_state(),
        }
    )


@save("/api/assistant/install")
def install(handler, request: Request, app) -> None:
    """Start asynchronous local-runtime installation.

    No world scope: the runtime is one shared process-wide resource.
    The installer port guards against a second concurrent install;
    `started=False` just means one was already running, not a failure -- the
    frontend polls /api/assistant/install/status either way.
    """

    handler.send_json(
        {
            "ok": True,
            "started": app.assistant_installation.start_async(),
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

    mode = str(payload.get("mode") or "chat")
    if mode not in {"chat", "world_extraction"}:
        raise ValueError("Unbekannter Assistant-Modus.")
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    chapter_ids = [str(item) for item in payload.get("chapterIds") or [] if isinstance(item, str)][
        :50
    ]
    run_batches = bool(payload.get("runBatches")) or mode == "world_extraction"
    progress_id = str(payload.get("progressId") or "")[:64] or None
    requested = str(payload.get("language") or "")
    language = requested if requested in ASSISTANT_REPLY_LANGUAGES else DEFAULT_ASSISTANT_LANGUAGE
    question = str(payload.get("question", "")).strip()
    if mode == "world_extraction":
        question = (
            "Update the world model from the selected manuscript chapters."
            if language == "en"
            else "Aktualisiere das Weltmodell aus den ausgewählten Manuskriptkapiteln."
        )
        history = []

    if not question or len(question) > 4000:
        raise ValueError("Die Nachricht muss zwischen 1 und 4000 Zeichen lang sein.")

    with app.lock:
        manuscript_document = app.documents.load("manuscript", world.db_path)
        figures_document = app.documents.load("figures", world.db_path)
        manuscript = manuscript_document.state
        figures = figures_document.state

    if mode == "world_extraction" and chapter_ids:
        available_ids = {
            str(chapter.get("id"))
            for chapter in manuscript.get("chapters") or []
            if isinstance(chapter, dict) and chapter.get("id")
        }
        if any(chapter_id not in available_ids for chapter_id in chapter_ids):
            raise ValueError("Mindestens ein ausgewähltes Kapitel existiert nicht mehr.")

    # `intent` defines equality for one idempotency key. progressId is UI
    # correlation and therefore deliberately excluded from the hash.
    intent = {
        "question": question,
        "history": history[-40:],
        "chapterIds": chapter_ids,
        "runBatches": run_batches,
        "mode": mode,
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
        "worldRevision": figures_document.revision,
    }
    return world, intent, execution


def _send_direct_error(handler, exc: Exception) -> None:
    handler.send_exception(exc)


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
            return handler.send_api_error(400, error_code="assistant.missing_idempotency_key")

        job, created = app.assistant_jobs.submit(
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
    except IdempotencyConflict:
        handler.send_api_error(
            409,
            error_code="assistant.idempotency_conflict",
            retryable=False,
        )
    except Exception as exc:
        _send_direct_error(handler, exc)


@get("/api/assistant/job", world=True)
def job_status(handler, request: Request, app) -> None:
    """Read one job through the same world-ownership gate as other world data."""

    job_id = request.param("id")
    if not job_id:
        return handler.send_api_error(400, error_code="assistant.job_id_invalid")

    job = app.assistant_jobs.get(job_id, request.session.sub, request.world.id)
    if job is None:
        return handler.send_api_error(404, error_code="assistant.job_not_found")
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
        job = app.assistant_jobs.cancel(job_id, request.session.sub, world.id)
        if job is None:
            return handler.send_api_error(404, error_code="assistant.job_not_found")
        handler.send_json({"ok": True, "job": job})
    except Exception as exc:
        _send_direct_error(handler, exc)
