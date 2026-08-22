"""Small stable surface shared by direct and marketplace purchase adapters.

A build's distribution profile describes technical constraints. It never
answers whether the current user owns a product; that belongs to a receipt or
account adapter implementing this contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Protocol, runtime_checkable


class EntitlementState(str, Enum):
    ACTIVE = "active"
    TRIAL = "trial"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class Entitlement:
    product_id: str
    state: EntitlementState
    source: str
    expires_at: datetime | None = None


@runtime_checkable
class EntitlementProvider(Protocol):
    def entitlement(self, product_id: str) -> Entitlement:
        """Resolve the current user's entitlement without changing it."""


__all__ = ["Entitlement", "EntitlementProvider", "EntitlementState"]
