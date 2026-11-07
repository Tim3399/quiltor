"""The local assistant: status, logs, progress, runtime install, jobs, and chat."""

from __future__ import annotations

from typing import Any

from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http.routes import Request, get, save
from quiltor.modules.assistant import (
    ASSISTANT_REPLY_LANGUAGES,
    DEFAULT_ASSISTANT_LANGUAGE,
)
from quiltor.modules.assistant.engines import EngineChoice, InvalidEngine, parse_engine
from quiltor.modules.assistant.jobs import IdempotencyConflict, TooManyOpenJobs
from quiltor.modules.assistant.planning_context import build_storyboard_knowledge
from quiltor.modules.assistant.ports import ClientJobRunning


@get("/api/assistant/status", world=True)
def status(handler, request: Request, app) -> None:
    if app.identity.multi_user and not app.identity.is_premium(request.session):
        # Without the role there is no assistant to describe, so nothing of the
        # runtime is reported: the client shows a hint instead of "offline" (F4).
        return handler.send_json(
            {
                "ok": True,
                "available": False,
                "premium": False,
                "installed": False,
                "reason": "",
                "chunks": 0,
            }
        )

    with app.lock:
        manuscript, figures = app.documents.load_pair(request.db_path)
        storyboards = app.documents.load("storyboards", request.db_path).state

    # Cheap no-op when already running -- picks up a runtime that finished
    # installing since the process started (or since the last poll) without
    # needing a full server restart.
    app.assistant.reload()

    handler.send_json(
        {
            "ok": True,
            **app.assistant.status(),
            "premium": True,
            "installed": app.assistant_installation.is_configured(),
            # False on a hosted server: the operator installs, the client shows no button.
            "installable": app.installable,
            "chunks": app.story_world.knowledge_chunk_count(manuscript, figures)
            + len(build_storyboard_knowledge(storyboards)),
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


@save("/api/assistant/install", operator_only=True)
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


def _engine_or_refuse(handler, request: Request, app, payload: Any) -> EngineChoice | None:
    """Decide who may compute this job, before the world is looked up (T-61, D-122).

    Order: the engine named in the body, then the instance switch for client engines,
    then the premium role for the server engine. Each refusal comes before any side
    effect, and before the world, so an account without the role cannot probe worlds.
    None means the answer has already been written.
    """

    try:
        engine = parse_engine(payload if isinstance(payload, dict) else {})
    except InvalidEngine:
        handler.send_api_error(400, error_code="assistant.engine_invalid", retryable=False)
        return None
    if engine.is_client and not app.client_ai:
        handler.send_api_error(403, error_code="assistant.client_ai_disabled", retryable=False)
        return None
    if not engine.is_client and not app.identity.is_premium(request.session):
        # The server engine runs on the operator's hardware or bill (D-40). The check
        # sits here and not in the dispatch, because only the body names the engine.
        handler.send_api_error(403, error_code="assistant.premium_required", retryable=False)
        return None
    return engine


def _prepare_request(
    handler, request: Request, app
) -> tuple[Any, dict[str, Any], dict[str, Any], EngineChoice] | None:
    """Validate one assistant request and snapshot the world it should reason over."""

    payload = handler._read_json_body()
    engine = _engine_or_refuse(handler, request, app, payload)
    if engine is None:
        return None
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return None

    mode = str(payload.get("mode") or "chat")
    if mode not in {"chat", "world_extraction"}:
        raise ValueError("Unknown assistant mode.")
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
        raise ValueError("The message must contain between 1 and 4000 characters.")

    with app.lock:
        manuscript_document = app.documents.load("manuscript", world.db_path)
        figures_document = app.documents.load("figures", world.db_path)
        storyboards_document = app.documents.load("storyboards", world.db_path)
        manuscript = manuscript_document.state
        figures = figures_document.state
        storyboards = storyboards_document.state

    if mode == "world_extraction" and chapter_ids:
        available_ids = {
            str(chapter.get("id"))
            for chapter in manuscript.get("chapters") or []
            if isinstance(chapter, dict) and chapter.get("id")
        }
        if any(chapter_id not in available_ids for chapter_id in chapter_ids):
            raise ValueError("At least one selected chapter no longer exists.")

    # `intent` defines equality for one idempotency key. progressId is UI
    # correlation and therefore deliberately excluded from the hash.
    intent = {
        "question": question,
        "history": history[-40:],
        "chapterIds": chapter_ids,
        "runBatches": run_batches,
        "mode": mode,
        "language": language,
        # Part of the request's identity: the same key with another engine is another job.
        "engine": engine.public(),
    }
    execution = {
        **intent,
        "worldId": world.id,
        "progressId": progress_id,
        # A queued job means "the world when Send was pressed", not whatever
        # happens to be in SQLite minutes later when the worker reaches it.
        "manuscript": manuscript,
        "figures": figures,
        "storyboards": storyboards,
        "worldRevision": figures_document.revision,
        "documentRevisions": {
            "manuscript": manuscript_document.revision,
            "figures": figures_document.revision,
            "storyboards": storyboards_document.revision,
        },
    }
    return world, intent, execution, engine


def _send_direct_error(handler, exc: Exception) -> None:
    handler.send_exception(exc)


@save("/api/assistant/jobs")
def create_job(handler, request: Request, app) -> None:
    """Create an idempotent assistant job and return without waiting for the model."""

    try:
        prepared = _prepare_request(handler, request, app)
        if prepared is None:
            return
        world, intent, execution, engine = prepared
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
            max_open=app.max_open_jobs,
            engine_kind=engine.kind,
        )
        handler.send_json(
            {
                "ok": True,
                "created": created,
                "job": job,
            },
            202 if created else 200,
        )
    except ClientJobRunning as running:
        error = http_errors.for_status(
            429,
            code="assistant.client_job_running",
            params={"jobId": running.job_id},
            retryable=False,
        )
        handler.send_json(error.payload(), error.status)
    except TooManyOpenJobs as refused:
        error = http_errors.for_status(
            429,
            code="assistant.too_many_jobs",
            params={"limit": refused.limit},
            retryable=True,
        )
        handler.send_json(error.payload(), error.status)
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
            raise ValueError("Assistant job is missing.")
        job = app.assistant_jobs.cancel(job_id, request.session.sub, world.id)
        if job is None:
            return handler.send_api_error(404, error_code="assistant.job_not_found")
        handler.send_json({"ok": True, "job": job})
    except Exception as exc:
        _send_direct_error(handler, exc)
