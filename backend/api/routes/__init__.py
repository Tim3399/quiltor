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
    one user (`app.IDENTITY.multi_user`). These are the routes that have nothing
    to do when there is only ever one identity: `/login` and `/auth/callback`
    are steps of choosing an account, and `/logout` is putting one down again.
    A single-user instance answers 404 for them -- not a redirect, not an empty
    JSON object, because pretending to have an account system is worse than not
    having one. It is pinned by
    tests/backend/test_server_auth.py::LocalIdentityServerTest.

The `app` argument is the `server` module. See this package's parent for why the
routes are handed it rather than importing it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

Route = Callable[[Any, "Request", Any], None]


@dataclass
class Registration:
    handler: Route
    world: bool = False
    anonymous: bool = False
    auth_only: bool = False


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
    from backend.api.routes import (  # noqa: F401
        assistant, backup, documents, identity, language, worlds,
    )
