"""The route table.

Each route is a function `(handler, request, app) -> None` that writes exactly
one response. Registration is declarative, so three properties that would
otherwise sit far from the route they govern are stated with it:

  - **`world=True`** means the route needs a per-user world resolved before it
    runs. Under OIDC that resolution can fail with 400/403/404, and the dispatch
    handles that once instead of at each call site.
  - **`anonymous=True`** means the route is reachable without a session: the
    version probe and the login flow itself.
  - **`auth_only=True`** means the route only exists where there is more than
    one user (`app.identity.multi_user`). These are the routes that have nothing
    to do when there is only ever one identity: `/login` and `/auth/callback`
    are steps of choosing an account, and `/logout` is putting one down again.
    A single-user instance answers 404 for them -- not a redirect, not an empty
    JSON object, because pretending to have an account system is worse than not
    having one. It is pinned by
    tests/python/test_server_auth.py::LocalIdentityServerTest.
  - **`operator_only=True`** means the route installs software on the server
    (a runtime, a model, a dictionary). In the `hosted` operation profile that
    is the operator's job, not a user's: the dispatch answers
    `403 install.forbidden_hosted` before the route runs. Every route that
    installs carries it. `GET /api/assistant/install/status` contains `install`
    in its path but only reads progress, so it is not `operator_only`: a hosted
    client may still show "Bereit". tests/python/test_operator_only_routes.py
    holds the table.
  - **`device_sync=True`** means the route syncs worlds with another device
    through a backup endpoint: the sync itself, the endpoint's remote worlds and
    remote restore, and signing in to that endpoint. A hosted server already is
    the shared storage for everyone on it (D-61), so in the `hosted` operation
    profile the dispatch answers `403 sync.forbidden_hosted` before the route
    runs. Two routes decide it from their body instead: `POST /api/backup` with
    `push` and `POST /api/worlds/create` with a `backupUrl`.
    tests/python/test_device_sync_routes.py holds the table.
  - There is no premium option. The assistant's job route decides from its
    body which engine computes the job, and only the server engine needs the
    role (T-61), so `POST /api/assistant/jobs` checks it itself, before the
    world. The other job routes are bound to the caller's own jobs.

The `app` argument is the concrete WebApplication owned by the HTTP server
instance. Routes never import a composition root or process-global store.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

Route = Callable[[Any, "Request", Any], None]


@dataclass
class Registration:
    handler: Route
    world: bool = False
    anonymous: bool = False
    auth_only: bool = False
    operator_only: bool = False
    device_sync: bool = False


@dataclass
class Request:
    """Everything the dispatch worked out before the route runs."""

    path: str
    query: dict[str, list[str]] = field(default_factory=dict)
    session: Any = None
    world: Any = None  # server.WorldContext when `world=True`, else None

    def param(self, name: str, default: str = "") -> str:
        return (self.query.get(name) or [default])[0]

    @property
    def db_path(self):
        return self.world.db_path if self.world else None


GET: dict[str, Registration] = {}
SAVE: dict[str, Registration] = {}


def _register(table: dict[str, Registration], path: str, **options):
    def decorate(function: Route) -> Route:
        if path in table:
            raise RuntimeError(f"Route {path} is already registered.")
        table[path] = Registration(function, **options)
        return function

    return decorate


def get(path: str, **options):
    """A GET route."""
    return _register(GET, path, **options)


def save(path: str, **options):
    """A POST/PUT route. Quiltor treats the two the same: PUT for the document
    saves, POST for everything else, all through one handler."""
    return _register(SAVE, path, **options)


def load() -> None:
    """Import every route module so their decorators run.

    Called once by server.py. Explicit rather than a directory scan, so the set
    of routes is greppable and an unimported module fails loudly at startup
    rather than as a 404 much later.
    """
    from quiltor.delivery.http.routes import (  # noqa: F401
        assistant,
        assistant_relay,
        backup,
        capabilities,
        documents,
        history,
        identity,
        manuscript_export,
        manuscript_import,
        place_maps,
        project_transfer,
        synchronization,
        worlds,
        writing_assistance,
    )
