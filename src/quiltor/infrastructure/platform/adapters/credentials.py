"""Credential-vault adapters for desktop and headless hosts."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import shutil
import subprocess
import threading
from ctypes import wintypes
from pathlib import Path
from typing import Any

from quiltor.infrastructure.platform import directories, system
from quiltor.infrastructure.platform.ports import CredentialVault, CredentialVaultError

_lock = threading.RLock()


def _key(service: str, account: str) -> str:
    if not service or not account or "\0" in service or "\0" in account:
        raise ValueError("Credential service and account must be non-empty text.")
    return f"{service}\0{account}"


class InMemoryCredentialVault:
    """Deterministic adapter for tests and ephemeral hosts."""

    def __init__(self) -> None:
        self._secrets: dict[str, str] = {}

    def read(self, service: str, account: str) -> str | None:
        return self._secrets.get(_key(service, account))

    def write(self, service: str, account: str, secret: str) -> None:
        self._secrets[_key(service, account)] = secret

    def delete(self, service: str, account: str) -> None:
        self._secrets.pop(_key(service, account), None)


class RestrictedFileCredentialVault:
    """0600 file fallback for headless systems without a keychain service.

    This is deliberately an adapter, not a hidden fallback inside backup code.
    Deployments that require a hardware/OS keystore can reject this adapter at
    composition time.  It remains necessary for containers and minimal Linux
    machines where no user session owns a Secret Service collection.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, str]:
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        secrets = document.get("secrets") if isinstance(document, dict) else None
        if not isinstance(secrets, dict):
            return {}
        return {str(key): str(value) for key, value in secrets.items()}

    def _save(self, secrets: dict[str, str]) -> None:
        if not secrets:
            self.path.unlink(missing_ok=True)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": 1, "secrets": secrets}, ensure_ascii=False).encode()
        handle = os.open(str(self.path), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(handle, 0o600)
            os.write(handle, payload)
        finally:
            os.close(handle)

    def read(self, service: str, account: str) -> str | None:
        with _lock:
            return self._load().get(_key(service, account))

    def write(self, service: str, account: str, secret: str) -> None:
        with _lock:
            secrets = self._load()
            secrets[_key(service, account)] = secret
            self._save(secrets)

    def delete(self, service: str, account: str) -> None:
        with _lock:
            secrets = self._load()
            secrets.pop(_key(service, account), None)
            self._save(secrets)


class WindowsDpapiCredentialVault(RestrictedFileCredentialVault):
    """Per-user DPAPI encrypted file; ciphertext is useless to another user."""

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    @classmethod
    def _protect(cls, payload: bytes) -> bytes:
        source_buffer = ctypes.create_string_buffer(payload)
        source = cls._Blob(len(payload), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
        result = cls._Blob()
        protect = ctypes.windll.crypt32.CryptProtectData
        protect.argtypes = [
            ctypes.POINTER(cls._Blob),
            wintypes.LPCWSTR,
            ctypes.POINTER(cls._Blob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(cls._Blob),
        ]
        protect.restype = wintypes.BOOL
        if not protect(
            ctypes.byref(source),
            "Quiltor credentials",
            None,
            None,
            None,
            0x1,  # CRYPTPROTECT_UI_FORBIDDEN: a background app must never prompt
            ctypes.byref(result),
        ):
            raise CredentialVaultError("Windows could not encrypt Quiltor credentials.")
        try:
            return ctypes.string_at(result.pbData, result.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(result.pbData)

    @classmethod
    def _unprotect(cls, payload: bytes) -> bytes:
        source_buffer = ctypes.create_string_buffer(payload)
        source = cls._Blob(len(payload), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
        result = cls._Blob()
        unprotect = ctypes.windll.crypt32.CryptUnprotectData
        unprotect.argtypes = [
            ctypes.POINTER(cls._Blob),
            ctypes.POINTER(wintypes.LPWSTR),
            ctypes.POINTER(cls._Blob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(cls._Blob),
        ]
        unprotect.restype = wintypes.BOOL
        if not unprotect(ctypes.byref(source), None, None, None, None, 0x1, ctypes.byref(result)):
            raise CredentialVaultError("Windows could not decrypt Quiltor credentials.")
        try:
            return ctypes.string_at(result.pbData, result.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(result.pbData)

    def _load(self) -> dict[str, str]:
        try:
            encrypted = base64.b64decode(self.path.read_bytes(), validate=True)
            document = json.loads(self._unprotect(encrypted).decode("utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
            raise CredentialVaultError("The Windows credential vault is unreadable.") from exc
        secrets = document.get("secrets") if isinstance(document, dict) else None
        return (
            {str(key): str(value) for key, value in secrets.items()}
            if isinstance(secrets, dict)
            else {}
        )

    def _save(self, secrets: dict[str, str]) -> None:
        if not secrets:
            self.path.unlink(missing_ok=True)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        clear = json.dumps({"version": 1, "secrets": secrets}, ensure_ascii=False).encode()
        payload = base64.b64encode(self._protect(clear))
        handle = os.open(str(self.path), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        try:
            os.write(handle, payload)
        finally:
            os.close(handle)


class MacOsKeychainCredentialVault:
    """macOS login-keychain adapter using the system ``security`` client."""

    def read(self, service: str, account: str) -> str | None:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 44:
            return None
        if result.returncode:
            raise CredentialVaultError(result.stderr.strip() or "macOS Keychain lookup failed.")
        return result.stdout.rstrip("\n")

    def write(self, service: str, account: str, secret: str) -> None:
        result = subprocess.run(
            [
                "security",
                "add-generic-password",
                "-U",
                "-s",
                service,
                "-a",
                account,
                "-w",
                secret,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            raise CredentialVaultError(result.stderr.strip() or "macOS Keychain update failed.")

    def delete(self, service: str, account: str) -> None:
        result = subprocess.run(
            ["security", "delete-generic-password", "-s", service, "-a", account],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode not in (0, 44):
            raise CredentialVaultError(result.stderr.strip() or "macOS Keychain delete failed.")


class LinuxSecretServiceCredentialVault:
    """Freedesktop Secret Service adapter through ``secret-tool``."""

    def read(self, service: str, account: str) -> str | None:
        result = subprocess.run(
            ["secret-tool", "lookup", "service", service, "account", account],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            return None
        return result.stdout.rstrip("\n")

    def write(self, service: str, account: str, secret: str) -> None:
        result = subprocess.run(
            [
                "secret-tool",
                "store",
                "--label",
                "Quiltor credential",
                "service",
                service,
                "account",
                account,
            ],
            input=secret,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            raise CredentialVaultError(result.stderr.strip() or "Secret Service update failed.")

    def delete(self, service: str, account: str) -> None:
        subprocess.run(
            ["secret-tool", "clear", "service", service, "account", account],
            capture_output=True,
            check=False,
        )


def default_credential_vault() -> CredentialVault:
    """Select one credential adapter at composition time.

    ``QUILTOR_CREDENTIAL_BACKEND=file`` is an explicit escape hatch for
    containers, tests and keychain-less sessions. It never silently downgrades
    Windows/macOS desktop builds from their OS-protected store.
    """
    selected = os.environ.get("QUILTOR_CREDENTIAL_BACKEND", "auto").strip().casefold()
    paths = directories.current()
    file_path = paths.config / "credentials.json"
    if selected == "memory":
        return InMemoryCredentialVault()
    if selected == "file":
        return RestrictedFileCredentialVault(file_path)
    if selected not in ("", "auto"):
        raise ValueError(f"Unknown credential backend: {selected}")
    if system.os_name() == "windows":
        return WindowsDpapiCredentialVault(paths.config / "credentials.dpapi")
    if system.os_name() == "macos" and shutil.which("security"):
        return MacOsKeychainCredentialVault()
    if system.os_name() == "linux" and shutil.which("secret-tool"):
        return LinuxSecretServiceCredentialVault()
    return RestrictedFileCredentialVault(file_path)


__all__ = [
    "InMemoryCredentialVault",
    "LinuxSecretServiceCredentialVault",
    "MacOsKeychainCredentialVault",
    "RestrictedFileCredentialVault",
    "WindowsDpapiCredentialVault",
    "default_credential_vault",
]
