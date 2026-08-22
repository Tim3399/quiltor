"""Explicit default entitlement for the free, local Quiltor product."""

from quiltor.application.capabilities import FREE_LOCAL_PRODUCT
from quiltor.modules.commerce.contract import Entitlement, EntitlementState


class FreeLocalEntitlementProvider:
    """The non-store default: free/local is active; unknown products are not."""

    def entitlement(self, product_id: str) -> Entitlement:
        active = product_id == FREE_LOCAL_PRODUCT
        return Entitlement(
            product_id=product_id,
            state=EntitlementState.ACTIVE if active else EntitlementState.INACTIVE,
            source="free-local",
        )


__all__ = ["FreeLocalEntitlementProvider"]
