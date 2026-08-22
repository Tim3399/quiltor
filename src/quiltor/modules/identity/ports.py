"""Capabilities required by identity without choosing their storage adapters."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from quiltor.modules.identity.auth import SessionData


@runtime_checkable
class OwnerIdentityStore(Protocol):
    @property
    def local_owner_id(self) -> str: ...


@runtime_checkable
class RenderTokenStore(Protocol):
    @property
    def ttl_seconds(self) -> int: ...

    def issue(self, subject: str) -> str: ...

    def redeem(self, token: str) -> str | None: ...


@runtime_checkable
class IdentityGateway(Protocol):
    """Process-scoped sessions and OIDC operations supplied by infrastructure."""

    @property
    def issuer(self) -> str: ...

    @property
    def client_id(self) -> str: ...

    @property
    def enabled(self) -> bool: ...

    @property
    def session_ttl(self) -> int: ...

    def discover(self, issuer: str | None = None) -> dict[str, Any]: ...

    def start_login(
        self, redirect_uri: str, *, issuer: str | None = None, client_id: str | None = None
    ) -> tuple[str, str]: ...

    def consume_pending_login(self, state: str) -> dict[str, Any] | None: ...

    def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> dict[str, Any]: ...

    def refresh_tokens(
        self,
        refresh_token: str,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> dict[str, Any]: ...

    def validate_claims(
        self, claims: dict[str, Any], issuer: str | None = None, client_id: str | None = None
    ) -> None: ...

    def verify_id_token(
        self,
        id_token: str,
        expected_nonce: str | None,
        *,
        issuer: str | None = None,
        client_id: str | None = None,
    ) -> dict[str, Any]: ...

    def create_session(
        self, sub: str, email: str, name: str, *, ttl: float | None = None
    ) -> str: ...

    def get_session(self, session_id: str | None) -> SessionData | None: ...

    def store_session_tokens(
        self,
        session_id: str,
        tokens: dict[str, Any],
        *,
        verified_id_token: str | None = None,
    ) -> SessionData | None: ...

    def session_access_token(self, session_id: str, *, leeway: float = 30) -> str: ...

    def destroy_session(self, session_id: str | None) -> None: ...

    def owner_session(self, sub: str) -> tuple[str, SessionData]: ...

    def end_session_url(
        self,
        id_token_hint: str | None = None,
        post_logout_redirect_uri: str | None = None,
    ) -> str | None: ...


__all__ = ["IdentityGateway", "OwnerIdentityStore", "RenderTokenStore"]
