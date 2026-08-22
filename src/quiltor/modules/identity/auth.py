"""Pure identity values and cryptographic OpenID Connect validation rules."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Mapping

SESSION_TTL = 24 * 60 * 60
PENDING_LOGIN_TTL = 10 * 60
MAX_TOKEN_BYTES = 32 * 1024
MAX_SUBJECT_LENGTH = 255
MAX_CLOCK_SKEW_SECONDS = 60
RESERVED_SUBJECT_PREFIX = "quiltor-internal:"
ALLOWED_ID_TOKEN_ALGORITHMS = frozenset({"RS256", "ES256"})


@dataclass(frozen=True, slots=True)
class IdentityConfiguration:
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    allow_insecure_loopback: bool = False
    trusted_endpoint_origins: tuple[str, ...] = ()
    allowed_id_token_algorithms: tuple[str, ...] = ("RS256", "ES256")

    def __post_init__(self) -> None:
        object.__setattr__(self, "issuer", self.issuer.rstrip("/"))
        object.__setattr__(
            self,
            "trusted_endpoint_origins",
            tuple(origin.rstrip("/") for origin in self.trusted_endpoint_origins),
        )
        algorithms = tuple(dict.fromkeys(self.allowed_id_token_algorithms))
        if not algorithms or not set(algorithms).issubset(ALLOWED_ID_TOKEN_ALGORITHMS):
            raise ValueError("OIDC ID-token algorithm allowlist is invalid.")
        object.__setattr__(self, "allowed_id_token_algorithms", algorithms)

    @property
    def enabled(self) -> bool:
        return bool(self.issuer)


@dataclass(frozen=True, slots=True)
class SessionData:
    sub: str
    email: str
    name: str
    created_at: float
    expires_at: float
    access_token: str = ""
    refresh_token: str = ""
    access_expires_at: float = 0.0
    id_token: str = ""
    session_id: str = ""


class InvalidTokenSignature(ValueError):
    """A trusted kid was selected but its signature did not verify."""


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _decode_segment(segment: str, *, maximum: int = MAX_TOKEN_BYTES) -> bytes:
    if not segment or len(segment) > maximum * 2:
        raise ValueError("Malformed ID token.")
    try:
        payload = base64.b64decode(
            segment + "=" * (-len(segment) % 4), altchars=b"-_", validate=True
        )
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Malformed ID token.") from exc
    if len(payload) > maximum:
        raise ValueError("Malformed ID token.")
    return payload


def _strict_object(payload: bytes, label: str) -> dict[str, Any]:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Malformed ID token {label}.")
            result[key] = value
        return result

    try:
        decoded = json.loads(payload.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Malformed ID token {label}.") from exc
    if not isinstance(decoded, dict):
        raise ValueError(f"Malformed ID token {label}.")
    return decoded


def decode_id_token_header(id_token: str) -> dict[str, Any]:
    if not isinstance(id_token, str) or len(id_token.encode("utf-8")) > MAX_TOKEN_BYTES:
        raise ValueError("Malformed ID token.")
    parts = id_token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed ID token.")
    return _strict_object(_decode_segment(parts[0]), "header")


def decode_id_token_claims(id_token: str) -> dict[str, Any]:
    if not isinstance(id_token, str) or len(id_token.encode("utf-8")) > MAX_TOKEN_BYTES:
        raise ValueError("Malformed ID token.")
    parts = id_token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed ID token.")
    return _strict_object(_decode_segment(parts[1]), "claims")


def validate_claims(
    claims: Mapping[str, Any],
    *,
    issuer: str,
    client_id: str,
    now: float,
    expected_nonce: str | None = None,
) -> None:
    subject = claims.get("sub")
    if (
        not isinstance(subject, str)
        or not subject
        or len(subject) > MAX_SUBJECT_LENGTH
        or subject.startswith(RESERVED_SUBJECT_PREFIX)
        or unicodedata.normalize("NFC", subject) != subject
        or any(unicodedata.category(char).startswith("C") for char in subject)
    ):
        raise ValueError("Invalid token subject.")
    if claims.get("iss") != issuer:
        raise ValueError("Unexpected token issuer.")
    audience = claims.get("aud")
    if isinstance(audience, str):
        audiences = [audience]
    elif (
        isinstance(audience, list)
        and 0 < len(audience) <= 16
        and all(isinstance(item, str) and item for item in audience)
    ):
        audiences = audience
    else:
        raise ValueError("Unexpected token audience.")
    if client_id not in audiences:
        raise ValueError("Unexpected token audience.")
    if len(audiences) > 1 and claims.get("azp") != client_id:
        raise ValueError("Unexpected authorized party.")
    expires = claims.get("exp")
    issued_at = claims.get("iat")
    if type(expires) is not int or type(issued_at) is not int:
        raise ValueError("Invalid token timestamps.")
    if expires <= now - MAX_CLOCK_SKEW_SECONDS:
        raise ValueError("Token has expired.")
    if issued_at > now + MAX_CLOCK_SKEW_SECONDS:
        raise ValueError("Invalid token issue time.")
    authorized_party = claims.get("azp")
    if authorized_party is not None and authorized_party != client_id:
        raise ValueError("Unexpected authorized party.")
    if len(audiences) > 1 and authorized_party != client_id:
        raise ValueError("Unexpected authorized party.")
    if "nbf" in claims:
        not_before = claims["nbf"]
        if type(not_before) is not int:
            raise ValueError("Invalid token not-before time.")
        if not_before > now + MAX_CLOCK_SKEW_SECONDS:
            raise ValueError("Token is not valid yet.")
    if expected_nonce is not None:
        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not hmac.compare_digest(nonce, expected_nonce):
            raise ValueError("Unexpected token nonce.")


def verify_id_token(
    id_token: str,
    jwk: Mapping[str, Any],
    *,
    issuer: str,
    client_id: str,
    now: float,
    expected_nonce: str | None,
    allowed_algorithms: tuple[str, ...] = ("RS256", "ES256"),
) -> dict[str, Any]:
    """Verify a compact ID token with an issuer-bound JWK, then its claims."""

    try:
        import jwt
    except ImportError as exc:  # pragma: no cover - exercised by packaging smoke checks
        raise RuntimeError("OIDC cryptographic verification support is unavailable.") from exc

    header = decode_id_token_header(id_token)
    algorithm = header.get("alg")
    if algorithm not in allowed_algorithms or algorithm not in ALLOWED_ID_TOKEN_ALGORITHMS:
        raise ValueError("Unsupported ID token algorithm.")
    if "crit" in header or "b64" in header:
        raise ValueError("Unsupported ID token header parameters.")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid or len(kid) > 255:
        raise ValueError("Invalid ID token key identifier.")
    if jwk.get("kid") != kid or jwk.get("use", "sig") != "sig":
        raise ValueError("ID token key does not match.")
    if jwk.get("alg", algorithm) != algorithm:
        raise ValueError("ID token key algorithm does not match.")
    key_ops = jwk.get("key_ops")
    if key_ops is not None and (not isinstance(key_ops, list) or "verify" not in key_ops):
        raise ValueError("ID token key may not verify signatures.")
    if algorithm == "RS256" and jwk.get("kty") != "RSA":
        raise ValueError("ID token key type does not match.")
    if algorithm == "ES256" and (jwk.get("kty") != "EC" or jwk.get("crv") != "P-256"):
        raise ValueError("ID token key type does not match.")
    try:
        signing_key = jwt.PyJWK.from_dict(dict(jwk), algorithm=algorithm)
        claims = jwt.decode(
            id_token,
            key=signing_key,
            algorithms=list(allowed_algorithms),
            audience=client_id,
            issuer=issuer,
            leeway=MAX_CLOCK_SKEW_SECONDS,
            options={
                "require": ["iss", "sub", "aud", "exp", "iat"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "verify_nbf": True,
                "verify_iss": True,
                "verify_aud": True,
                "verify_sub": True,
            },
        )
    except jwt.InvalidSignatureError as exc:
        raise InvalidTokenSignature("ID token signature verification failed.") from exc
    except (jwt.PyJWTError, TypeError, ValueError) as exc:
        raise ValueError("ID token verification failed.") from exc
    if not isinstance(claims, dict):
        raise ValueError("Malformed ID token claims.")
    validate_claims(
        claims,
        issuer=issuer,
        client_id=client_id,
        now=now,
        expected_nonce=expected_nonce,
    )
    return claims


def validate_master_token(token: str) -> None:
    valid_urlsafe = re.fullmatch(r"[A-Za-z0-9_-]{43,256}", token) is not None
    valid_hex = re.fullmatch(r"[A-Fa-f0-9]{64,256}", token) is not None
    if not (valid_urlsafe or valid_hex):
        raise ValueError(
            "QUILTOR_MASTER_TOKEN must be 43+ URL-safe random characters or 64+ hex characters."
        )


__all__ = [
    "ALLOWED_ID_TOKEN_ALGORITHMS",
    "IdentityConfiguration",
    "InvalidTokenSignature",
    "MAX_CLOCK_SKEW_SECONDS",
    "PENDING_LOGIN_TTL",
    "RESERVED_SUBJECT_PREFIX",
    "SESSION_TTL",
    "SessionData",
    "decode_id_token_claims",
    "decode_id_token_header",
    "pkce_challenge",
    "validate_claims",
    "validate_master_token",
    "verify_id_token",
]
