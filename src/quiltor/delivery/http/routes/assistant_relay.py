"""The browser's side of the relay: pick up a model call, answer it (T-61).

A job on a client engine is computed in the user's browser. The server builds the
request and hands it out as a one-time ticket (`relay/next`); the browser runs it and
posts back only the model's text or an error code (`relay/answer`). The world is named in
the query, so the dispatch resolves and refuses it before any body is read (D-38).

Nothing of a body is logged. An answer is read only up to 256 KiB, and only its known
fields are passed on; anything else in it is dropped.
"""

from __future__ import annotations

import re
from typing import Any

from quiltor.delivery.http.routes import Request, get, save
from quiltor.modules.assistant.engines import CLIENT_ERROR_CODES
from quiltor.modules.assistant.ports import (
    RelayTicketExpired,
    RelayTicketNotFound,
    RelayTooManyFailures,
)

#: The largest answer the server reads; the client checks before it sends.
MAX_ANSWER_BYTES = 256 * 1024
#: How long `relay/next` waits for a ticket before it answers 204.
LONG_POLL_SECONDS = 25.0
#: How much of a browser's error text reaches the job's own owner.
MAX_DETAIL_CHARS = 200
FINISH_REASONS = frozenset({"stop", "length"})
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def session_key(session: Any) -> str:
    """The session a ticket is bound to. The local single user has no session id; its
    one browser is the session."""
    return session.session_id or f"local:{session.sub}"


def _client_ai_or_refuse(handler, app) -> bool:
    if app.client_ai:
        return True
    handler.send_api_error(403, error_code="assistant.client_ai_disabled", retryable=False)
    return False


def _refuse_relay(handler, error: Exception) -> None:
    if isinstance(error, RelayTooManyFailures):
        handler.send_api_error(429, error_code="relay.too_many_failures", retryable=True)
    elif isinstance(error, RelayTicketExpired):
        handler.send_api_error(410, error_code="relay.ticket_expired", retryable=False)
    else:
        handler.send_api_error(404, error_code="relay.ticket_not_found", retryable=False)


@get("/api/assistant/relay/next", world=True)
def relay_next(handler, request: Request, app) -> None:
    """The open model call of one of the caller's client jobs, waiting up to 25 s."""

    if not _client_ai_or_refuse(handler, app):
        return
    job_id = request.param("job")
    if not job_id:
        return handler.send_api_error(400, error_code="assistant.job_id_invalid")
    job = app.assistant_jobs.get(job_id, request.session.sub, request.world.id)
    # A server job is not the browser's business: it looks like no job at all.
    if job is None or job.get("engine") == "server":
        return handler.send_api_error(404, error_code="assistant.job_not_found")
    try:
        # No app.lock: the wait is on the ticket store alone.
        ticket = app.relay_tickets.next_for(
            sub=request.session.sub,
            session_id=session_key(request.session),
            world_id=request.world.id,
            job_id=job_id,
            wait=LONG_POLL_SECONDS,
        )
    except (RelayTicketNotFound, RelayTicketExpired, RelayTooManyFailures) as refused:
        return _refuse_relay(handler, refused)
    if ticket is None:
        handler.send_response(204)
        handler.end_headers()
        return
    handler.send_json(
        {
            "ok": True,
            "request": {
                "ticket": ticket.token,
                "seq": ticket.seq,
                "engine": ticket.engine,
                "payload": ticket.payload,
                "limits": {
                    "maxOutputBytes": MAX_ANSWER_BYTES,
                    "answerBySeconds": ticket.answer_seconds,
                },
            },
        }
    )


def _invalid(handler) -> None:
    handler.send_api_error(400, error_code="relay.answer_invalid", retryable=False)


def _clean_detail(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return _CONTROL.sub("", value)[:MAX_DETAIL_CHARS]


def _answer_from(payload: Any) -> tuple[str, dict[str, Any]] | None:
    """The ticket and the answer's known fields, or None when the shape is wrong."""
    if not isinstance(payload, dict) or not isinstance(payload.get("ticket"), str):
        return None
    output, error = payload.get("output"), payload.get("error")
    if (output is None) == (error is None):
        return None
    if output is not None:
        if not isinstance(output, dict) or not isinstance(output.get("content"), str):
            return None
        finish = output.get("finishReason", "stop")
        if finish not in FINISH_REASONS:
            return None
        answer: dict[str, Any] = {"content": output["content"], "finishReason": finish}
        usage = output.get("usage")
        if isinstance(usage, dict):
            answer["usage"] = {
                key: usage[key]
                for key in ("promptTokens", "completionTokens")
                if isinstance(usage.get(key), int) and not isinstance(usage.get(key), bool)
            }
        return payload["ticket"], {"output": answer}
    if not isinstance(error, dict) or error.get("code") not in CLIENT_ERROR_CODES:
        return None
    cleaned: dict[str, Any] = {"code": error["code"]}
    status = error.get("status")
    if isinstance(status, int) and not isinstance(status, bool):
        cleaned["status"] = status
    detail = _clean_detail(error.get("detail"))
    if detail:
        cleaned["detail"] = detail
    return payload["ticket"], {"error": cleaned}


@save("/api/assistant/relay/answer", world=True)
def relay_answer(handler, request: Request, app) -> None:
    """The browser's answer to one ticket: the model's text, or an error code."""

    if not _client_ai_or_refuse(handler, app):
        return
    declared = (handler.headers.get("Content-Length") or "").strip()
    if not declared.isdigit() or int(declared) > MAX_ANSWER_BYTES:
        # Refused unread: a larger body is more than any answer of ours, and reading it
        # would be the work a sender wants to cause (D-38 accepts the reset, plan F7).
        handler.close_connection = True
        return handler.send_api_error(413, error_code="relay.answer_too_large", retryable=False)
    try:
        payload = handler._read_json_body()
    except (ValueError, RecursionError):
        return _invalid(handler)
    parsed = _answer_from(payload)
    if parsed is None:
        return _invalid(handler)
    token, answer = parsed
    try:
        app.relay_tickets.answer(
            token,
            sub=request.session.sub,
            session_id=session_key(request.session),
            world_id=request.world.id,
            answer=answer,
        )
    except (RelayTicketNotFound, RelayTicketExpired, RelayTooManyFailures) as refused:
        return _refuse_relay(handler, refused)
    handler.send_json({"ok": True})
