"""Wire application ports to local-first infrastructure adapters."""

from __future__ import annotations

import os
import secrets
import threading
from dataclasses import dataclass, replace
from pathlib import Path

from quiltor import resources
from quiltor.application.assistant import AssistantAuditUseCases
from quiltor.application.backups import BackupUseCases
from quiltor.application.capabilities import FeatureAvailability
from quiltor.application.documents import DocumentUseCases
from quiltor.application.history import HistoryUseCases
from quiltor.application.story_world import StoryWorldReadTools, StoryWorldUseCases
from quiltor.application.telemetry import UseCaseObserver
from quiltor.application.worlds import WorldUseCases
from quiltor.infrastructure.commerce import FreeLocalEntitlementProvider
from quiltor.infrastructure.backup import SnapshotStore
from quiltor.infrastructure.backup.adapters import (
    HttpRemoteBackupGateway,
    OidcBackupLoginGateway,
)
from quiltor.infrastructure.backup.authorization import EndpointBoundBackupAuthorizer
from quiltor.infrastructure.backup.login import BackupLoginRuntime
from quiltor.infrastructure.identity import (
    InMemoryRenderTokenStore,
    SQLiteOwnerIdentityStore,
    StdlibIdentityGateway,
)
from quiltor.infrastructure.inference.engine import LocalInferenceEngine
from quiltor.infrastructure.inference.installation import LocalAssistantInstallation
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.infrastructure.observability import (
    InMemoryMetrics,
    RuntimeDiagnostics,
    StdlibStructuredLogger,
)
from quiltor.infrastructure.persistence.assistant_interactions import (
    ApplicationAssistantWorldAccess,
    LockedAssistantInteractionLogger,
)
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.infrastructure.persistence.assistant_progress import SQLiteAssistantProgressStore
from quiltor.infrastructure.persistence.adapters.backups import SQLiteBackupRepository
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from quiltor.infrastructure.platform.feature_availability import (
    DistributionCapabilitySource,
    HostCapabilitySource,
    PlatformCapabilitySource,
)
from quiltor.infrastructure.platform.runtime_target import (
    BuildProfile,
    ProcessRole,
    RuntimeTarget,
    current_profile,
    current_target,
    target_for_profile,
)
from quiltor.infrastructure.writing_assistance import build_writing_assistance
from quiltor.modules.assistant import AssistantRuntime
from quiltor.modules.assistant.jobs import AssistantJobRunner
from quiltor.modules.assistant.ports import AssistantInstallation, InferenceEngine
from quiltor.modules.commerce.contract import EntitlementProvider
from quiltor.modules.identity.auth import IdentityConfiguration, validate_master_token
from quiltor.modules.identity.ports import IdentityGateway, RenderTokenStore
from quiltor.modules.identity.service import Identity, LocalIdentity, OidcIdentity
from quiltor.modules.writing_assistance import WritingAssistanceService


@dataclass(frozen=True, slots=True)
class ObservabilityServices:
    logger: StdlibStructuredLogger
    diagnostics: RuntimeDiagnostics
    metrics: InMemoryMetrics


@dataclass(frozen=True, slots=True)
class AssistantServices:
    runtime: AssistantRuntime
    jobs: AssistantJobRunner


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    """Explicit application slices shared by host composition roots."""

    worlds: WorldUseCases
    documents: DocumentUseCases
    backups: BackupUseCases
    history: HistoryUseCases
    assistant: AssistantAuditUseCases
    story_world: StoryWorldUseCases


@dataclass(frozen=True, slots=True)
class McpApplicationServices:
    """Read/proposal slices exposed to the MCP host; no backup/login runtime."""

    worlds: WorldUseCases
    documents: DocumentUseCases
    story_world: StoryWorldUseCases


def build_mcp_application_services(
    observability: ObservabilityServices,
    persistence_paths: SQLitePaths | None = None,
) -> McpApplicationServices:
    worlds = SQLiteWorldRepository(persistence_paths or SQLitePaths.from_environment())
    documents = SQLiteDocumentRepository()
    local_backups = SQLiteBackupRepository()
    observer = UseCaseObserver(observability.logger, observability.metrics)
    return McpApplicationServices(
        worlds=WorldUseCases(worlds, observer),
        documents=DocumentUseCases(documents, local_backups, observer),
        story_world=StoryWorldUseCases(),
    )


def build_application_services(
    capabilities: FeatureAvailability,
    observability: ObservabilityServices,
    persistence_paths: SQLitePaths | None = None,
) -> ApplicationServices:
    worlds = SQLiteWorldRepository(persistence_paths or SQLitePaths.from_environment())
    documents = SQLiteDocumentRepository()
    local_backups = SQLiteBackupRepository()
    observer = UseCaseObserver(observability.logger, observability.metrics)
    remote_backups = HttpRemoteBackupGateway(
        lambda: os.environ.get("QUILTOR_BACKUP_URL", ""),
        capabilities,
        structured_logger=observability.logger,
        metrics=observability.metrics,
    )
    backup_login = BackupLoginRuntime(
        client_id=os.environ.get("QUILTOR_BACKUP_CLIENT_ID", "quiltor-desktop"),
        data_directory=lambda: worlds.data_directory,
        allow_insecure_loopback=(
            os.environ.get("QUILTOR_BACKUP_OIDC_ALLOW_INSECURE_LOOPBACK", "") == "1"
        ),
    )
    history = SnapshotStore(lambda: worlds.data_directory / "history", remote_backups)
    return ApplicationServices(
        worlds=WorldUseCases(worlds, observer),
        documents=DocumentUseCases(documents, local_backups, observer),
        backups=BackupUseCases(
            worlds,
            documents,
            local_backups,
            history,
            remote_backups,
            OidcBackupLoginGateway(backup_login),
            observer,
        ),
        history=HistoryUseCases(history, local_backups.safe_name),
        assistant=AssistantAuditUseCases(worlds, documents),
        story_world=StoryWorldUseCases(),
    )


def build_backup_authorizer(
    backups: BackupUseCases,
    *,
    expected_hosted_issuer: str = "",
) -> EndpointBoundBackupAuthorizer:
    return EndpointBoundBackupAuthorizer(
        default_endpoint=backups.default_endpoint,
        environment_token=lambda: os.environ.get("QUILTOR_BACKUP_TOKEN", ""),
        endpoint_token=backups.access_token,
        expected_hosted_issuer=expected_hosted_issuer,
    )


def build_observability(profile: BuildProfile | None = None) -> ObservabilityServices:
    selected = profile or current_profile()
    return ObservabilityServices(
        logger=StdlibStructuredLogger(),
        diagnostics=RuntimeDiagnostics(
            {
                "buildProfile": selected.identifier,
                "host": selected.host.value,
                "platform": selected.platform.value,
                "distribution": selected.distribution.value,
            }
        ),
        metrics=InMemoryMetrics(),
    )


def build_feature_availability(
    profile: BuildProfile | None = None,
    entitlements: EntitlementProvider | None = None,
    target: RuntimeTarget | None = None,
    process_role: ProcessRole | None = None,
) -> FeatureAvailability:
    selected = profile or current_profile()
    selected_target = target or (
        current_target() if profile is None else target_for_profile(selected, frozen=False)
    )
    if process_role is not None:
        selected_target = replace(selected_target, process_role=process_role)
    return FeatureAvailability(
        host=HostCapabilitySource(selected_target.host, selected_target.process_role),
        platform=PlatformCapabilitySource(selected_target.platform),
        distribution=DistributionCapabilitySource(selected),
        entitlements=entitlements or FreeLocalEntitlementProvider(),
    )


def build_identity(
    oidc_enabled: bool | None = None,
    *,
    gateway: IdentityGateway | None = None,
    issuer: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    master_token: str | None = None,
    render_tokens: RenderTokenStore | None = None,
) -> Identity:
    selected_gateway = gateway or StdlibIdentityGateway(
        IdentityConfiguration(
            issuer=(issuer if issuer is not None else os.environ.get("QUILTOR_OIDC_ISSUER", "")),
            client_id=(
                client_id if client_id is not None else os.environ.get("QUILTOR_OIDC_CLIENT_ID", "")
            ),
            client_secret=(
                client_secret
                if client_secret is not None
                else os.environ.get("QUILTOR_OIDC_CLIENT_SECRET", "")
            ),
            allow_insecure_loopback=(
                os.environ.get("QUILTOR_OIDC_ALLOW_INSECURE_LOOPBACK", "") == "1"
            ),
            trusted_endpoint_origins=tuple(
                item.strip()
                for item in os.environ.get("QUILTOR_OIDC_TRUSTED_ENDPOINT_ORIGINS", "").split(",")
                if item.strip()
            ),
        )
    )
    selected_render_tokens = render_tokens or InMemoryRenderTokenStore()
    enabled = selected_gateway.enabled if oidc_enabled is None else oidc_enabled
    if enabled:
        return OidcIdentity(selected_gateway, selected_render_tokens)
    configured_token = (
        master_token if master_token is not None else os.environ.get("QUILTOR_MASTER_TOKEN")
    )
    if configured_token is None:
        token = secrets.token_urlsafe(32)
    else:
        validate_master_token(configured_token)
        token = configured_token
    return LocalIdentity(
        SQLiteOwnerIdentityStore(), selected_gateway, selected_render_tokens, token
    )


def build_assistant_installation(
    capabilities: FeatureAvailability,
    home: Path | None = None,
) -> AssistantInstallation:
    selected_home = home or Path(os.environ.get("QUILTOR_HOME", str(resources.source_root())))
    return LocalAssistantInstallation(capabilities, home=selected_home)


def build_assistant_services(
    *,
    base: Path,
    data: Path,
    assistant: AssistantAuditUseCases,
    lock: threading.Lock,
    observability: ObservabilityServices,
    capabilities: FeatureAvailability,
    inference: InferenceEngine | None = None,
) -> AssistantServices:
    runtime = AssistantRuntime(
        base,
        data,
        inference or LocalInferenceEngine(base, data, capabilities),
        progress=SQLiteAssistantProgressStore(data / "assistant-progress.sqlite3"),
        read_tools=StoryWorldReadTools(),
        token_cache=BoundedTokenCountCache(),
        debug_enabled=bool(os.environ.get("QUILTOR_AI_DEBUG")),
    )
    interactions = LockedAssistantInteractionLogger(assistant, lock)
    jobs = AssistantJobRunner(
        runtime,
        store_factory=lambda: AssistantJobStore(data / "assistant-jobs.sqlite3"),
        interaction_logger=interactions,
        world_access=ApplicationAssistantWorldAccess(assistant),
        structured_logger=observability.logger,
        metrics=observability.metrics,
    )
    return AssistantServices(runtime, jobs)


def build_writing_assistance_service(
    data: Path, capabilities: FeatureAvailability
) -> WritingAssistanceService:
    return build_writing_assistance(data, capabilities)
