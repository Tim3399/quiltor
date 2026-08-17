"""The local assistant: status, logs, progress, runtime install, and chat."""
from __future__ import annotations

from datetime import datetime

from backend.api.routes import Request, get, save
from backend.assistant import (
    ASSISTANT_REPLY_LANGUAGES, DEFAULT_ASSISTANT_LANGUAGE, read_progress,
)
from backend.core import storage
from backend.core.knowledge import build_knowledge
from backend.llm.installer import install_async, is_configured, read_install_state


@get("/api/assistant/status", world=True)
def status(handler, request: Request, app) -> None:
    with app._lock:
        manuscript = storage.load_manuscript(request.db_path)
        figures = storage.load_figures(request.db_path)
    # Cheap no-op when already running -- picks up a runtime that finished
    # installing since the process started (or since the last poll) without
    # needing a full server restart.
    app.ASSISTANT.reload()
    handler.send_json({"ok": True, **app.ASSISTANT.status(), "installed": is_configured(),
                       "chunks": len(build_knowledge(manuscript, figures))})


@get("/api/assistant/logs", world=True)
def logs(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json({"ok": True,
                           "interactions": storage.list_assistant_interactions(db_path=request.db_path)})


@get("/api/assistant/progress")
def progress(handler, request: Request, app) -> None:
    # No lock: this reads the in-memory progress registry, not SQLite, so it is
    # safe to poll while a batch run is in flight on another thread.
    identifier = request.param("id")
    state = read_progress(identifier) if identifier else None
    handler.send_json({"ok": state is not None, "progress": state})


@get("/api/assistant/install/status")
def install_status(handler, request: Request, app) -> None:
    # No lock: reads backend/llm/installer.py's own in-memory progress registry.
    handler.send_json({"ok": True, **read_install_state()})


@save("/api/assistant/install")
def install(handler, request: Request, app) -> None:
    """No world scope: the runtime is one shared process-wide resource.
    install_async() guards against a second concurrent install; `started=False`
    just means one was already running, not a failure -- the frontend polls
    /api/assistant/install/status either way."""
    handler.send_json({"ok": True, "started": install_async()})


@save("/api/assistant/chat")
def chat(handler, request: Request, app) -> None:
    question = ""
    try:
        payload = handler._read_json_body()
    except Exception as exc:
        return handler.send_json({"ok": False, "fehler": str(exc), "errorType": _classify(str(exc))}, 503)
    # Before anything else, so the failed-interaction log below already knows
    # which world's database to write to.
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    db_path = world.db_path
    try:
        question = str(payload.get("question", "")).strip()
        history = payload.get("history") if isinstance(payload.get("history"), list) else []
        chapter_ids = [str(item) for item in payload.get("chapterIds") or [] if isinstance(item, str)][:50]
        run_batches = bool(payload.get("runBatches"))
        progress_id = str(payload.get("progressId") or "")[:64] or None
        requested = str(payload.get("language") or "")
        language = requested if requested in ASSISTANT_REPLY_LANGUAGES else DEFAULT_ASSISTANT_LANGUAGE
        if not question or len(question) > 4000:
            raise ValueError("Die Nachricht muss zwischen 1 und 4000 Zeichen lang sein.")
        with app._lock:
            manuscript = storage.load_manuscript(db_path)
            figures = storage.load_figures(db_path)
        result = app.ASSISTANT.complete(question, manuscript, figures, history[-40:],
                                        chapter_ids, run_batches, progress_id, language)
        with app._lock:
            interaction_id = storage.log_assistant_interaction(question, result, db_path=db_path)
        print(f"  · {datetime.now():%H:%M:%S}  AI request {interaction_id} — "
              f"{len(result.get('sources', []))} sources, {len(result.get('proposals', []))} proposals",
              flush=True)
        handler.send_json({"ok": True, "interactionId": interaction_id, **result})
    except Exception as exc:
        if question:
            with app._lock:
                interaction_id = storage.log_assistant_interaction(question, error=str(exc), db_path=db_path)
            print(f"  ! {datetime.now():%H:%M:%S}  AI request {interaction_id} failed — {exc}", flush=True)
        handler.send_json({"ok": False, "fehler": str(exc), "errorType": _classify(str(exc))}, 503)


def _classify(message: str) -> str:
    """Turn the runtime's German error text into a stable code the frontend can
    branch on without matching prose itself."""
    if "Kontextfenster" in message:
        return "context_too_large"
    if "nicht erreichbar" in message or "nicht installiert" in message:
        return "runtime_unavailable"
    if "nicht rechtzeitig" in message:
        return "response_truncated"
    if "strukturiert" in message or "gültig" in message:
        return "validation_error"
    if "Zeit" in message or "timeout" in message.casefold():
        return "timeout"
    return "assistant_error"
