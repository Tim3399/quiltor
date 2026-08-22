"""Secure credential persistence supplied by a platform host."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class CredentialVaultError(RuntimeError):
    """A platform credential store could not complete an operation."""


@runtime_checkable
class CredentialVault(Protocol):
    """Smallest useful keychain contract.

    Values are opaque UTF-8 strings to the adapter.  JSON and token semantics
    belong to the capability using the vault, not to the platform layer.
    """

    def read(self, service: str, account: str) -> str | None: ...

    def write(self, service: str, account: str, secret: str) -> None: ...

    def delete(self, service: str, account: str) -> None: ...


__all__ = ["CredentialVault", "CredentialVaultError"]
