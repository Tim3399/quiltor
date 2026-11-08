"""One-time tickets that carry a model call to the browser computing a job (T-61).

The server builds every prompt and checks every answer (D-37). For a job on a client
engine it hands the finished request to the user's browser as a ticket, and takes back
only the model's text. A ticket is bound to the account, the session, the world, the job
and its place in the job's sequence of calls; it is answered once, within its deadline.

Everything lives in memory: a ticket is transport, not data (D-40). The binding of a job
to a session is made when the job is submitted (`bind_job`) and dies with the process,
which is why a restart fails open client jobs (`recover_interrupted`). The worker may
issue a job's first ticket before that binding exists (it claims the job the moment it is
queued); the binding is therefore looked up when the ticket is picked up or answered,
and a ticket nobody may pick up simply runs into its delivery deadline.

Refusals do not say why: an unknown ticket, someone else's ticket and a ticket of another
session look the same (`RelayTicketNotFound`). Failed attempts are counted per session;
after five in ten minutes the session is refused outright (`RelayTooManyFailures`).
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

#: Seconds a browser has to pick up a ticket before the job counts as abandoned.
DELIVER_SECONDS = 20.0
#: Seconds a browser has to answer a ticket it picked up, by engine.
ANSWER_SECONDS = {"webllm": 300.0, "cloud": 120.0}
#: Seconds one client job may take across all its calls.
JOB_SECONDS = 20 * 60.0
#: Open tickets at once in this process; one client job holds at most one.
TICKET_CAPACITY = 256
FAILURE_LIMIT = 5
FAILURE_WINDOW_SECONDS = 600.0
#: How long a finished job is remembered, so its own session may still poll it once
#: without that counting as a failure (the browser cannot know which ticket was the last).
FINISHED_SECONDS = FAILURE_WINDOW_SECONDS
#: How often a waiter looks at the clock even when nobody notifies it.
_POLL_SECONDS = 0.05


class RelayTicketNotFound(LookupError):
    """No ticket matches: unknown, someone else's, or not this session's."""


class RelayTicketExpired(LookupError):
    """The ticket was answered, cancelled, or ran out of time."""


class RelayTooManyFailures(LookupError):
    """The session has failed too often recently; refused without looking."""


class RelayDeliveryTimeout(TimeoutError):
    """Nobody picked the ticket up in time: the browser is gone."""


class RelayAnswerTimeout(TimeoutError):
    """The browser picked the ticket up but did not answer in time."""

    def __init__(self, seconds: float) -> None:
        super().__init__(f"The browser did not answer within {seconds:g} seconds.")
        self.seconds = seconds


class RelayCancelled(RuntimeError):
    """The job was cancelled, or the store is shutting down."""


class RelayFull(RuntimeError):
    """No ticket can be opened: too many are open in this process."""


@dataclass(frozen=True, slots=True)
class JobBinding:
    sub: str
    session_id: str
    world_id: str


@dataclass(slots=True)
class Ticket:
    token: str
    job_id: str
    seq: int
    payload: dict[str, Any]
    engine: dict[str, Any]
    deliver_by: float
    answer_seconds: float
    answer_by: float | None = None
    state: str = "issued"  # issued | delivered | answered | cancelled | expired
    answer: dict[str, Any] = field(default_factory=dict)


class RelayTicketStore:
    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        token_factory: Callable[[int], str] = secrets.token_urlsafe,
        capacity: int = TICKET_CAPACITY,
    ) -> None:
        self._clock = clock
        self._token_factory = token_factory
        self._capacity = capacity
        self._condition = threading.Condition()
        self._bindings: dict[str, JobBinding] = {}
        self._expected_seq: dict[str, int] = {}
        self._cancelled_jobs: set[str] = set()
        # job id -> (binding it had, until when it is remembered as finished)
        self._finished: dict[str, tuple[JobBinding, float]] = {}
        self._tickets: dict[str, Ticket] = {}
        self._failures: dict[str, deque[float]] = {}
        self._closed = False

    # -- jobs ---------------------------------------------------------------------------

    def bind_job(self, job_id: str, *, sub: str, session_id: str, world_id: str) -> None:
        """Remember which session computes this job. Called where the job is submitted."""
        if not (job_id and sub and session_id and world_id):
            raise ValueError("A relay binding needs a job, an account, a session and a world.")
        with self._condition:
            self._bindings[job_id] = JobBinding(sub, session_id, world_id)
            self._expected_seq.setdefault(job_id, 0)

    def release_job(self, job_id: str) -> None:
        """Forget a finished job and every ticket it left.

        Its binding is kept for a while as a finished marker: the job's own session still
        polling it gets nothing, without a failure counted; anyone else still fails.
        """
        with self._condition:
            binding = self._bindings.pop(job_id, None)
            if binding is not None:
                self._finished[job_id] = (binding, self._clock() + FINISHED_SECONDS)
            self._expected_seq.pop(job_id, None)
            self._cancelled_jobs.discard(job_id)
            for token in [t for t, ticket in self._tickets.items() if ticket.job_id == job_id]:
                self._tickets.pop(token, None)
            self._condition.notify_all()

    def cancel(self, job_id: str) -> None:
        """Wake whoever waits for this job's answer at once (F-61-5)."""
        with self._condition:
            self._cancelled_jobs.add(job_id)
            for ticket in self._tickets.values():
                if ticket.job_id == job_id and ticket.state in {"issued", "delivered"}:
                    ticket.state = "cancelled"
            self._condition.notify_all()

    def close(self) -> None:
        """Cancel everything; every waiter returns."""
        with self._condition:
            self._closed = True
            for ticket in self._tickets.values():
                if ticket.state in {"issued", "delivered"}:
                    ticket.state = "cancelled"
            self._condition.notify_all()

    # -- the server side ------------------------------------------------------------------

    def issue(
        self,
        job_id: str,
        payload: dict[str, Any],
        *,
        engine: dict[str, Any],
        answer_seconds: float,
    ) -> Ticket:
        """Open the next ticket of a job. The previous one, if any, is no longer valid."""
        with self._condition:
            if self._closed or job_id in self._cancelled_jobs:
                raise RelayCancelled("The job was cancelled.")
            self._expire_overdue()
            for ticket in self._tickets.values():
                if ticket.job_id == job_id and ticket.state in {"issued", "delivered"}:
                    ticket.state = "expired"
            open_tickets = sum(t.state in {"issued", "delivered"} for t in self._tickets.values())
            if open_tickets >= self._capacity:
                raise RelayFull("Too many relay tickets are open.")
            seq = self._expected_seq.get(job_id, 0) + 1
            self._expected_seq[job_id] = seq
            ticket = Ticket(
                token=self._token_factory(24),
                job_id=job_id,
                seq=seq,
                payload=payload,
                engine=engine,
                deliver_by=self._clock() + DELIVER_SECONDS,
                answer_seconds=answer_seconds,
            )
            self._tickets[ticket.token] = ticket
            self._condition.notify_all()
            return ticket

    def wait_answer(self, ticket: Ticket) -> dict[str, Any]:
        """Block until the ticket is answered; raise when it cannot be any more."""
        with self._condition:
            while True:
                if ticket.state == "answered":
                    return ticket.answer
                if ticket.state == "cancelled" or self._closed:
                    raise RelayCancelled("The job was cancelled.")
                now = self._clock()
                if ticket.state == "issued" and now >= ticket.deliver_by:
                    ticket.state = "expired"
                    raise RelayDeliveryTimeout("No browser picked up the request.")
                if (
                    ticket.state == "delivered"
                    and ticket.answer_by is not None
                    and now >= ticket.answer_by
                ):
                    ticket.state = "expired"
                    raise RelayAnswerTimeout(ticket.answer_seconds)
                if ticket.state == "expired":
                    raise RelayCancelled("The ticket was replaced.")
                self._condition.wait(timeout=_POLL_SECONDS)

    # -- the browser side -----------------------------------------------------------------

    def next_for(
        self, *, sub: str, session_id: str, world_id: str, job_id: str, wait: float
    ) -> Ticket | None:
        """The open ticket of this job for this session, waiting up to `wait` seconds.

        None when nothing arrives in time. A job that is not this session's is refused
        like an unknown one.
        """
        deadline = self._clock() + wait
        caller = JobBinding(sub, session_id, world_id)
        with self._condition:
            self._refuse_if_blocked(session_id)
            self._forget_finished()
            binding = self._bindings.get(job_id)
            if binding is None and self._finished.get(job_id, (None, 0.0))[0] == caller:
                return None
            if binding != caller:
                self._fail(session_id, RelayTicketNotFound())
            while True:
                if self._closed or self._bindings.get(job_id) != caller:
                    return None
                self._expire_overdue()
                for ticket in self._tickets.values():
                    if ticket.job_id == job_id and ticket.state == "issued":
                        ticket.state = "delivered"
                        ticket.answer_by = self._clock() + ticket.answer_seconds
                        self._condition.notify_all()
                        return ticket
                if job_id in self._cancelled_jobs or self._clock() >= deadline:
                    return None
                self._condition.wait(timeout=_POLL_SECONDS)

    def answer(
        self,
        token: str,
        *,
        sub: str,
        session_id: str,
        world_id: str,
        answer: dict[str, Any],
    ) -> Ticket:
        """Hand the browser's answer to the waiting call. Each ticket answers once."""
        with self._condition:
            self._refuse_if_blocked(session_id)
            ticket = self._tickets.get(token)
            if ticket is None or self._bindings.get(ticket.job_id) != JobBinding(
                sub, session_id, world_id
            ):
                self._fail(session_id, RelayTicketNotFound())
            assert ticket is not None  # noqa: S101 - _fail always raises
            self._expire_overdue()
            if ticket.seq != self._expected_seq.get(ticket.job_id):
                self._fail(session_id, RelayTicketNotFound())
            if ticket.state != "delivered":
                self._fail(session_id, RelayTicketExpired())
            ticket.state = "answered"
            ticket.answer = answer
            self._condition.notify_all()
            return ticket

    # -- helpers --------------------------------------------------------------------------

    def _expire_overdue(self) -> None:
        now = self._clock()
        for ticket in self._tickets.values():
            if (ticket.state == "issued" and now >= ticket.deliver_by) or (
                ticket.state == "delivered"
                and ticket.answer_by is not None
                and now >= ticket.answer_by
            ):
                ticket.state = "expired"

    def _forget_finished(self) -> None:
        now = self._clock()
        for job_id in [j for j, (_, until) in self._finished.items() if until <= now]:
            self._finished.pop(job_id, None)

    def _recent_failures(self, session_id: str) -> deque[float]:
        failures = self._failures.setdefault(session_id, deque())
        cutoff = self._clock() - FAILURE_WINDOW_SECONDS
        while failures and failures[0] < cutoff:
            failures.popleft()
        return failures

    def _refuse_if_blocked(self, session_id: str) -> None:
        if len(self._recent_failures(session_id)) >= FAILURE_LIMIT:
            raise RelayTooManyFailures("Too many failed relay requests from this session.")

    def _fail(self, session_id: str, error: LookupError) -> None:
        failures = self._recent_failures(session_id)
        failures.append(self._clock())
        if len(failures) >= FAILURE_LIMIT:
            raise RelayTooManyFailures("Too many failed relay requests from this session.")
        raise error


__all__ = [
    "ANSWER_SECONDS",
    "DELIVER_SECONDS",
    "FAILURE_LIMIT",
    "JOB_SECONDS",
    "JobBinding",
    "RelayAnswerTimeout",
    "RelayCancelled",
    "RelayDeliveryTimeout",
    "RelayFull",
    "RelayTicketExpired",
    "RelayTicketNotFound",
    "RelayTicketStore",
    "RelayTooManyFailures",
    "Ticket",
]
