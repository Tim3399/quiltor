"""Effective feature availability across every independent policy axis.

The machine, host, distribution and commercial entitlement answer different
questions.  A feature is available only when all four say yes; callers never
need to infer one axis from another (for example, a store build from the OS).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Protocol, runtime_checkable

from quiltor.modules.commerce.contract import EntitlementProvider, EntitlementState


FREE_LOCAL_PRODUCT = "quiltor.free.local"


class Feature(str, Enum):
    CODE_DOWNLOAD = "code_download"
    EXTERNAL_PROCESS = "external_process"
    SELF_UPDATE = "self_update"
    ARBITRARY_FILE_ACCESS = "arbitrary_file_access"
    BACKGROUND_EXECUTION = "background_execution"
    LOCAL_INFERENCE = "local_inference"
    WRITING_ASSISTANCE_GRAMMAR = "writing_assistance_grammar"
    REMOTE_BACKUP = "remote_backup"


@dataclass(frozen=True, slots=True)
class AxisAvailability:
    allowed: bool
    reason: str = ""


@runtime_checkable
class CapabilitySource(Protocol):
    def availability(self, feature: Feature) -> AxisAvailability: ...


@dataclass(frozen=True, slots=True)
class EffectiveCapabilities:
    feature: Feature
    available: bool
    host: AxisAvailability
    platform: AxisAvailability
    distribution: AxisAvailability
    entitlement: AxisAvailability

    @property
    def reasons(self) -> tuple[str, ...]:
        return tuple(
            decision.reason
            for decision in (self.host, self.platform, self.distribution, self.entitlement)
            if not decision.allowed and decision.reason
        )


class StaticCapabilitySource:
    """Value-backed source useful for deterministic host composition and tests."""

    def __init__(
        self,
        values: Mapping[Feature, bool] | None = None,
        *,
        default: bool = True,
        axis: str = "runtime",
    ) -> None:
        self._values = dict(values or {})
        self._default = default
        self._axis = axis

    def availability(self, feature: Feature) -> AxisAvailability:
        allowed = self._values.get(feature, self._default)
        reason = "" if allowed else f"{self._axis} disallows {feature.value}"
        return AxisAvailability(allowed, reason)


class FeatureAvailability:
    """Central service computing Host ∩ Platform ∩ Distribution ∩ Entitlement."""

    def __init__(
        self,
        *,
        host: CapabilitySource,
        platform: CapabilitySource,
        distribution: CapabilitySource,
        entitlements: EntitlementProvider,
        products: Mapping[Feature, str] | None = None,
    ) -> None:
        self._host = host
        self._platform = platform
        self._distribution = distribution
        self._entitlements = entitlements
        self._products = dict(products or {})

    def evaluate(self, feature: Feature) -> EffectiveCapabilities:
        host = self._host.availability(feature)
        platform = self._platform.availability(feature)
        distribution = self._distribution.availability(feature)
        product_id = self._products.get(feature, FREE_LOCAL_PRODUCT)
        entitlement = self._entitlements.entitlement(product_id)
        entitled = entitlement.state in {EntitlementState.ACTIVE, EntitlementState.TRIAL}
        entitlement_axis = AxisAvailability(
            entitled,
            "" if entitled else f"entitlement {product_id} is {entitlement.state.value}",
        )
        available = all(item.allowed for item in (host, platform, distribution, entitlement_axis))
        return EffectiveCapabilities(
            feature, available, host, platform, distribution, entitlement_axis
        )

    def is_available(self, feature: Feature) -> bool:
        return self.evaluate(feature).available


__all__ = [
    "AxisAvailability",
    "CapabilitySource",
    "EffectiveCapabilities",
    "FREE_LOCAL_PRODUCT",
    "Feature",
    "FeatureAvailability",
    "StaticCapabilitySource",
]
