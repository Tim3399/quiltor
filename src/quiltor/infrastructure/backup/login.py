"""Endpoint-bound OAuth/OIDC login runtime for remote backups.

All mutable state is instance-owned and injected by the composition root. The
backup endpoint's protected-resource metadata selects one issuer; that issuer's
strict discovery and JWKS then verify the ID token before any account data or
credentials are stored.
"""

from __future__ import annotations

import hmac
import json
import math
import threading
import time
import urllib.parse
from collections.abc import Callable
from pathlib import Path
from typing import Any

from quiltor.infrastructure.backup import remote
from quiltor.infrastructure.identity.runtime import StdlibIdentityGateway
from quiltor.infrastructure.platform.adapters.credentials import default_credential_vault
from quiltor.infrastructure.platform.ports import CredentialVault
from quiltor.modules.identity.auth import IdentityConfiguration, PENDING_LOGIN_TTL

DEFAULT_CLIENT_ID = "quiltor-desktop"
DEFAULT_SCOPE = "quiltor.backup"
PENDING_TTL = PENDING_LOGIN_TTL
REFRESH_LEEWAY = 30
PROBE_TTL = 5.0
PROBE_PATIENCE = 3.0
MAX_PENDING = 256
MAX_ENDPOINTS = 128
MAX_ISSUERS = 16
MAX_PROBES = 128
VAULT_SERVICE = "app.quiltor.backup"
VAULT_ACCOUNT = "endpoints"


class BackupLoginRuntime:
    """One process-scoped, endpoint-indexed backup login service."""

    VAULT_SERVICE = VAULT_SERVICE
    VAULT_ACCOUNT = VAULT_ACCOUNT
    PENDING_TTL = PENDING_TTL
    PROBE_PATIENCE = PROBE_PATIENCE

    def __init__(
        self,
        *,
        client_id: str = DEFAULT_CLIENT_ID,
        vault: CredentialVault | None = None,
        data_directory: Path | Callable[[], Path],
        clock: Callable[[], float] = time.time,
        allow_insecure_loopback: bool = False,
        gateway_factory: Callable[[str], StdlibIdentityGateway] | None = None,
    ) -> None:
        if not client_id or len(client_id) > 255:
            raise ValueError("Invalid backup OAuth client id.")
        self.client_id = client_id
        self._vault = vault or default_credential_vault()
        self._data_directory = data_directory
        self._clock = clock
        self._allow_insecure_loopback = allow_insecure_loopback
        self._gateway_factory = gateway_factory
        self._lock = threading.RLock()
        self._pending: dict[str, dict[str, Any]] = {}
        self._cache: dict[str, Any] | None = None
        self._probes: dict[str, tuple[float, tuple[str, str, bool]]] = {}
        self._probing: dict[str, threading.Thread] = {}
        self._gateways: dict[str, StdlibIdentityGateway] = {}
        self._endpoint_locks: dict[str, threading.Lock] = {}

    def path(self) -> Path:
        return self.legacy_path

    @property
    def pending_count(self) -> int:
        with self._lock:
            self._purge_pending()
            return len(self._pending)

    @property
    def legacy_path(self) -> Path:
        root = self._data_directory() if callable(self._data_directory) else self._data_directory
        return root / "backup-login.json"

    def _gateway(self, issuer: str) -> StdlibIdentityGateway:
        with self._lock:
            existing = self._gateways.get(issuer)
            if existing is not None:
                return existing
            if len(self._gateways) >= MAX_ISSUERS:
                raise RuntimeError("Backup identity issuer capacity has been reached.")
            gateway = (
                self._gateway_factory(issuer)
                if self._gateway_factory is not None
                else StdlibIdentityGateway(
                    IdentityConfiguration(
                        issuer=issuer,
                        client_id=self.client_id,
                        allow_insecure_loopback=self._allow_insecure_loopback,
                    )
                )
            )
            self._gateways[issuer] = gateway
            return gateway

    def issuer_for(self, base_url: str) -> tuple[str, str]:
        base = remote.canonical_endpoint(base_url)
        document = remote.resource_metadata(base)
        if document.get("resource") != base:
            raise RuntimeError("The backup endpoint did not publish valid issuer metadata.")
        servers = document.get("authorization_servers")
        if (
            not isinstance(servers, list)
            or len(servers) != 1
            or not isinstance(servers[0], str)
            or not servers[0]
        ):
            raise RuntimeError("The backup endpoint did not publish exactly one issuer.")
        issuer = servers[0].rstrip("/")
        # Constructing the gateway is itself strict issuer URL validation.
        self._gateway(issuer)
        scopes = document.get("scopes_supported", [])
        if (
            not isinstance(scopes, list)
            or len(scopes) > 32
            or not all(isinstance(scope, str) and 0 < len(scope) <= 255 for scope in scopes)
        ):
            raise RuntimeError("The backup endpoint published invalid OAuth scopes.")
        return issuer, scopes[0] if scopes else DEFAULT_SCOPE

    def _run_probe(self, base: str) -> None:
        try:
            issuer, scope = self.issuer_for(base)
            self._gateway(issuer).discover()
            result = (issuer, scope, True)
        except Exception:
            result = ("", "", False)
        with self._lock:
            self._probes[base] = (self._clock(), result)
            self._probing.pop(base, None)

    def _probe(self, base: str) -> tuple[str, str, bool | None]:
        now = self._clock()
        with self._lock:
            stamped = self._probes.get(base)
            if stamped is not None and now - stamped[0] < PROBE_TTL:
                return stamped[1]
            running = self._probing.get(base)
            ours = running is None or not running.is_alive()
            if ours:
                if base not in self._probing and len(self._probing) >= MAX_PROBES:
                    return ("", "", None)
                running = threading.Thread(
                    target=self._run_probe,
                    args=(base,),
                    name="quiltor-backup-login-probe",
                    daemon=True,
                )
                self._probing[base] = running
                running.start()
        if stamped is None and ours:
            running.join(PROBE_PATIENCE)
            with self._lock:
                stamped = self._probes.get(base)
        return stamped[1] if stamped is not None else ("", "", None)

    def _purge_pending(self) -> None:
        now = self._clock()
        for state in [
            state
            for state, entry in self._pending.items()
            if now - float(entry["created_at"]) > PENDING_TTL
        ]:
            self._pending.pop(state, None)

    def begin(self, base_url: str, redirect_uri: str) -> str:
        base = remote.canonical_endpoint(base_url)
        issuer, scope = self.issuer_for(base)
        gateway = self._gateway(issuer)
        document = gateway.discover()
        verifier, challenge = gateway.new_pkce_pair()
        state = gateway.new_state()
        nonce = gateway.new_state()
        with self._lock:
            self._purge_pending()
            if len(self._pending) >= MAX_PENDING:
                raise RuntimeError("Backup login capacity has been reached.")
            self._pending[state] = {
                "verifier": verifier,
                "redirect_uri": redirect_uri,
                "base_url": base,
                "issuer": issuer,
                "scope": scope,
                "nonce": nonce,
                "created_at": self._clock(),
            }
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": f"openid {scope} offline_access",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"{document['authorization_endpoint']}?{urllib.parse.urlencode(params)}"

    def consume_pending(self, state: str) -> dict[str, Any] | None:
        with self._lock:
            self._purge_pending()
            matched = next(
                (candidate for candidate in self._pending if hmac.compare_digest(candidate, state)),
                None,
            )
            return self._pending.pop(matched, None) if matched is not None else None

    @staticmethod
    def _bounded_token(tokens: dict[str, Any], name: str) -> str:
        value = tokens.get(name, "")
        if not isinstance(value, str) or len(value) > 64 * 1024:
            raise ValueError("The issuer returned an invalid token response.")
        return value

    def _expiry(self, tokens: dict[str, Any]) -> float:
        value = tokens.get("expires_in", 0)
        if isinstance(value, bool):
            raise ValueError("The issuer returned an invalid token lifetime.")
        try:
            seconds = float(value or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError("The issuer returned an invalid token lifetime.") from exc
        if not math.isfinite(seconds) or seconds < 0 or seconds > 24 * 60 * 60:
            raise ValueError("The issuer returned an invalid token lifetime.")
        return self._clock() + seconds

    def complete(self, code: str, state: str, redirect_uri: str) -> dict[str, Any]:
        pending = self.consume_pending(state)
        if pending is None:
            raise ValueError("Unknown or expired login attempt.")
        if not hmac.compare_digest(redirect_uri, pending["redirect_uri"]):
            raise ValueError("The login returned to a different redirect URI.")
        gateway = self._gateway(pending["issuer"])
        tokens = gateway.exchange_code(
            code,
            pending["verifier"],
            redirect_uri,
            client_id=self.client_id,
            client_secret="",
        )
        id_token = self._bounded_token(tokens, "id_token")
        claims = gateway.verify_id_token(id_token, pending["nonce"])
        access_token = self._bounded_token(tokens, "access_token")
        if not access_token:
            raise ValueError("The issuer returned no access token.")
        record = {
            "issuer": pending["issuer"],
            "scope": pending["scope"],
            "access_token": access_token,
            "refresh_token": self._bounded_token(tokens, "refresh_token"),
            "expires_at": self._expiry(tokens),
            "account": str(claims["sub"]),
            "email": str(claims.get("email", ""))[:320],
            "name": str(claims.get("name", ""))[:320],
        }
        self._store(pending["base_url"], record)
        return self.status(pending["base_url"])

    def _refresh(self, record: dict[str, Any]) -> dict[str, Any] | None:
        refresh_token = record.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            return None
        try:
            tokens = self._gateway(str(record["issuer"])).refresh_tokens(
                refresh_token,
                client_id=self.client_id,
                client_secret="",
            )
            access = self._bounded_token(tokens, "access_token")
            if not access:
                return None
            updated = dict(record)
            updated["access_token"] = access
            updated["refresh_token"] = self._bounded_token(tokens, "refresh_token") or refresh_token
            updated["expires_at"] = self._expiry(tokens)
            # A refresh response's optional ID token is not used until it has
            # been verified and subject-bound; the already verified account is
            # intentionally retained.
            return updated
        except Exception:
            return None

    def access_token(self, base_url: str) -> str:
        base = remote.canonical_endpoint(base_url)
        with self._lock:
            endpoint_lock = self._endpoint_locks.setdefault(base, threading.Lock())
        with endpoint_lock:
            record = self._read(base)
            if record is None:
                return ""
            if float(record.get("expires_at", 0)) - REFRESH_LEEWAY > self._clock():
                return str(record.get("access_token", ""))
            refreshed = self._refresh(record)
            current = self._read(base)
            if current is None:
                return ""
            if current.get("refresh_token") != record.get("refresh_token"):
                return str(current.get("access_token", ""))
            if refreshed is None:
                self.sign_out(base)
                return ""
            self._store(base, refreshed)
            return str(refreshed["access_token"])

    def status(self, base_url: str) -> dict[str, Any]:
        base = remote.canonical_endpoint(base_url)
        record = self._read(base)
        issuer = str(record.get("issuer", "")) if record else ""
        scope = str(record.get("scope", "")) if record else ""
        probed_issuer, probed_scope, reachable = self._probe(base)
        if reachable:
            issuer, scope = probed_issuer, probed_scope
        return {
            "endpoint": base,
            "signedIn": bool(record and record.get("access_token")),
            "account": str(record.get("account", "")) if record else "",
            "email": str(record.get("email", "")) if record else "",
            "name": str(record.get("name", "")) if record else "",
            "issuer": issuer,
            "scope": scope,
            "issuerReachable": reachable,
        }

    def sign_out(self, base_url: str) -> None:
        base = remote.canonical_endpoint(base_url)
        with self._lock:
            data = self._load()
            if data["endpoints"].pop(base, None) is not None:
                self._save(data)

    @staticmethod
    def _normalise(parsed: Any) -> dict[str, Any]:
        raw = parsed.get("endpoints") if isinstance(parsed, dict) else None
        endpoints: dict[str, dict[str, Any]] = {}
        if isinstance(raw, dict):
            for base, record in list(raw.items())[:MAX_ENDPOINTS]:
                if isinstance(base, str) and isinstance(record, dict):
                    try:
                        canonical = remote.canonical_endpoint(base)
                    except ValueError:
                        continue
                    if canonical == base:
                        endpoints[base] = dict(record)
        return {"version": 1, "endpoints": endpoints}

    def _load(self) -> dict[str, Any]:
        if self._cache is not None:
            return self._cache
        try:
            secret = self._vault.read(VAULT_SERVICE, VAULT_ACCOUNT)
            parsed = json.loads(secret) if secret else {}
        except (OSError, ValueError):
            parsed = {}
        self._cache = self._normalise(parsed)
        if self._cache["endpoints"] or not self.legacy_path.exists():
            return self._cache
        try:
            legacy = self._normalise(json.loads(self.legacy_path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return self._cache
        if legacy["endpoints"]:
            self._vault.write(VAULT_SERVICE, VAULT_ACCOUNT, json.dumps(legacy, ensure_ascii=False))
            self.legacy_path.unlink(missing_ok=True)
            self._cache = legacy
        return self._cache

    def _save(self, data: dict[str, Any]) -> None:
        if len(data["endpoints"]) > MAX_ENDPOINTS:
            raise RuntimeError("Backup login endpoint capacity has been reached.")
        self._cache = data
        if not data["endpoints"]:
            self._vault.delete(VAULT_SERVICE, VAULT_ACCOUNT)
            self.legacy_path.unlink(missing_ok=True)
            return
        self._vault.write(
            VAULT_SERVICE,
            VAULT_ACCOUNT,
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        )
        self.legacy_path.unlink(missing_ok=True)

    def _read(self, base: str) -> dict[str, Any] | None:
        with self._lock:
            record = self._load()["endpoints"].get(base)
            return dict(record) if isinstance(record, dict) else None

    def _store(self, base: str, record: dict[str, Any]) -> None:
        with self._lock:
            data = self._load()
            if base not in data["endpoints"] and len(data["endpoints"]) >= MAX_ENDPOINTS:
                raise RuntimeError("Backup login endpoint capacity has been reached.")
            data["endpoints"][base] = dict(record)
            self._save(data)

    def forget_cache(self) -> None:
        with self._lock:
            self._cache = None
            self._probes.clear()
            self._probing.clear()
            for gateway in self._gateways.values():
                gateway.clear()
            self._gateways.clear()

    def close(self) -> None:
        self.forget_cache()
        with self._lock:
            self._pending.clear()
            self._endpoint_locks.clear()


__all__ = [
    "BackupLoginRuntime",
    "DEFAULT_CLIENT_ID",
    "DEFAULT_SCOPE",
    "PENDING_TTL",
    "VAULT_ACCOUNT",
    "VAULT_SERVICE",
]
