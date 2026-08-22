"""Local-runtime installation adapter for the assistant product port."""

from __future__ import annotations

from typing import Any
from pathlib import Path

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.infrastructure.inference import installer
from quiltor.infrastructure.inference.coordinator import InstallationCoordinator


class LocalAssistantInstallation:
    """Expose an instance-owned installer without leaking it into delivery."""

    def __init__(
        self,
        capabilities: FeatureAvailability,
        coordinator: InstallationCoordinator | None = None,
        home: Path | None = None,
    ) -> None:
        self.capabilities = capabilities
        self.home = (home or installer.installer_paths().home).expanduser().resolve()
        self.coordinator = coordinator or InstallationCoordinator()

    def ensure_installed(self) -> None:
        if self._installation_allowed():
            installer.ensure_installed(self.home)

    def is_configured(self) -> bool:
        return self.capabilities.is_available(Feature.LOCAL_INFERENCE) and installer.is_configured(
            self.home
        )

    def read_state(self) -> dict[str, Any]:
        return self.coordinator.read()

    def start_async(self) -> bool:
        if not self._installation_allowed():
            return False
        selected = installer.resolve_runtime("auto")
        return self.coordinator.start(
            lambda on_progress: installer.install(selected, home=self.home, on_progress=on_progress)
        )

    def install_selected(self, runtime: str = "auto") -> str:
        if not self._installation_allowed():
            raise PermissionError("Local assistant installation is unavailable.")
        selected = installer.resolve_runtime(runtime)
        installer.install(selected, home=self.home)
        return selected

    def _installation_allowed(self) -> bool:
        return self.capabilities.is_available(
            Feature.LOCAL_INFERENCE
        ) and self.capabilities.is_available(Feature.CODE_DOWNLOAD)


__all__ = ["LocalAssistantInstallation"]
