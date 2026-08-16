"""Version probe and the OIDC login flow.

Everything except `/api/version` is `auth_only`: without QUILTOR_OIDC_ISSUER
these routes do not exist at all and the server answers 404, exactly as it did
before there was a route table. The local single-user build should not hint at
an account system it does not have.
"""
from __future__ import annotations

from backend.api.routes import Request, get, save


@get("/api/version", anonymous=True)
def version(handler, request: Request, app) -> None:
    """Also the readiness probe the desktop launcher and the test harness poll,
    so it answers before authentication is considered."""
    handler.send_json({"ok": True, "version": app.VERSION})


@get("/login", anonymous=True, auth_only=True)
def login(handler, request: Request, app) -> None:
    handler.handle_login()


@get("/auth/callback", anonymous=True, auth_only=True)
def auth_callback(handler, request: Request, app) -> None:
    handler.handle_auth_callback()


@get("/api/whoami", anonymous=True, auth_only=True)
def whoami(handler, request: Request, app) -> None:
    """Anonymous on purpose: the frontend calls it to find out *whether* anyone
    is signed in, so an unauthenticated caller gets `{"ok": false}` rather than
    a 401."""
    if request.session is None:
        return handler.send_json({"ok": False})
    handler.send_json({"ok": True, "sub": request.session.sub,
                       "email": request.session.email, "name": request.session.name})


@save("/logout", anonymous=True, auth_only=True)
def logout(handler, request: Request, app) -> None:
    handler.handle_logout()
