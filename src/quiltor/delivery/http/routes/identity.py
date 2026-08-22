"""Version probe, "who am I", and the OIDC login flow.

`/api/version` and `/api/whoami` exist everywhere: there is always a session, so
there is always an answer to who is asking, and the frontend uses `multiUser` in
that answer to decide whether accounts are a thing here at all.

`/login`, `/auth/callback` and `/logout` are `auth_only` -- they are the steps of
choosing an account and putting it down again, which a single-user instance has
no version of. It answers 404 for them rather than hinting at an account system
it does not have.
"""

from __future__ import annotations

from quiltor.delivery.http.routes import Request, get, save


@get("/api/version", anonymous=True)
def version(handler, request: Request, app) -> None:
    """Also the readiness probe the desktop launcher and the test harness poll,
    so it answers before authentication is considered."""
    handler.send_json({"ok": True, "version": app.version})


@get("/login", anonymous=True, auth_only=True)
def login(handler, request: Request, app) -> None:
    handler.handle_login()


@get("/auth/callback", anonymous=True, auth_only=True)
def auth_callback(handler, request: Request, app) -> None:
    handler.handle_auth_callback()


@get("/api/whoami")
def whoami(handler, request: Request, app) -> None:
    """Who is asking, and whether that was ever a choice.

    Reaching this route means the dispatch already resolved a session, so there
    is no unauthenticated caller to answer -- `multiUser` is what the frontend
    needs, to know whether to offer signing out at all.
    """
    handler.send_json(
        {
            "ok": True,
            "sub": request.session.sub,
            "email": request.session.email,
            "name": request.session.name,
            "multiUser": app.identity.multi_user,
        }
    )


@get("/api/diagnostics")
def diagnostics(handler, request: Request, app) -> None:
    """Authenticated, non-sensitive runtime health for local support bundles."""

    handler.send_json(
        {
            "ok": True,
            "runtime": dict(app.observability.diagnostics.snapshot()),
            "metrics": dict(app.observability.metrics.snapshot()),
        }
    )


@save("/logout", anonymous=True, auth_only=True)
def logout(handler, request: Request, app) -> None:
    handler.handle_logout()
