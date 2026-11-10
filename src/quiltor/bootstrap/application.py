"""Wire application ports to local-first infrastructure adapters."""

from __future__ import annotations

import json
import os
import secrets
import sys
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, NoReturn, cast

from quiltor import resources
from quiltor.application.assistant import AssistantAuditUseCases
from quiltor.application.backups import BackupUseCases
from quiltor.application.capabilities import FeatureAvailability
from quiltor.application.documents import DocumentUseCases
from quiltor.application.history import HistoryUseCases
from quiltor.application.manuscript_export import ManuscriptExportUseCases
from quiltor.application.manuscript_import import ManuscriptImportUseCases
from quiltor.application.place_maps import PlaceMapUseCases
from quiltor.application.project_transfer import ProjectTransferUseCases
from quiltor.application.story_world import StoryWorldReadTools, StoryWorldUseCases
from quiltor.application.synchronization import SynchronizationUseCases
from quiltor.application.telemetry import UseCaseObserver
from quiltor.application.worlds import WorldUseCases
from quiltor.application.worlds.example import ExampleWorldSource, ExampleWorldUseCases
from quiltor.infrastructure.backup import SnapshotStore
from quiltor.infrastructure.backup.adapters import (
    HttpRemoteBackupGateway,
    OidcBackupLoginGateway,
)
from quiltor.infrastructure.backup.authorization import EndpointBoundBackupAuthorizer
from quiltor.infrastructure.backup.login import BackupLoginRuntime
from quiltor.infrastructure.backup.sync_state import JsonSyncStateStore
from quiltor.infrastructure.commerce import FreeLocalEntitlementProvider
from quiltor.infrastructure.exporting.docx import DocxExportOptions, DocxPreset, serialize_docx
from quiltor.infrastructure.exporting.epub import EpubExportOptions, serialize_epub
from quiltor.infrastructure.identity import (
    InMemoryRenderTokenStore,
    SQLiteOwnerIdentityStore,
    StdlibIdentityGateway,
)
from quiltor.infrastructure.inference.engine import LocalInferenceEngine
from quiltor.infrastructure.inference.installation import LocalAssistantInstallation
from quiltor.infrastructure.inference.relay import RelayInferenceEngine, RelayTicketStore
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.infrastructure.observability import (
    InMemoryMetrics,
    RuntimeDiagnostics,
    StdlibStructuredLogger,
)
from quiltor.infrastructure.persistence.adapters.backups import SQLiteBackupRepository
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.place_maps import SQLitePlaceMapRepository
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.assistant_interactions import (
    ApplicationAssistantWorldAccess,
    LockedAssistantInteractionLogger,
)
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.infrastructure.persistence.assistant_progress import SQLiteAssistantProgressStore
from quiltor.infrastructure.persistence.manuscript_import import SQLiteManuscriptImportRepository
from quiltor.infrastructure.persistence.project_archive import SQLiteProjectTransferRepository
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
from quiltor.modules.assistant.jobs import (
    DEFAULT_CLIENT_JOB_SLOTS,
    MAX_CLIENT_JOB_SLOTS,
    AssistantJobRunner,
)
from quiltor.modules.assistant.ports import AssistantInstallation, InferenceEngine
from quiltor.modules.commerce.contract import EntitlementProvider
from quiltor.modules.identity.auth import IdentityConfiguration, validate_master_token
from quiltor.modules.identity.ports import IdentityGateway, RenderTokenStore
from quiltor.modules.identity.service import (
    DEFAULT_PREMIUM_ROLE,
    Identity,
    LocalIdentity,
    OidcIdentity,
)
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
    # Hands the model calls of client-engine jobs to the browser (T-61).
    relay_tickets: RelayTicketStore = field(default_factory=RelayTicketStore)


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    """Explicit application slices shared by host composition roots."""

    worlds: WorldUseCases
    documents: DocumentUseCases
    place_maps: PlaceMapUseCases
    example_worlds: ExampleWorldUseCases
    project_transfer: ProjectTransferUseCases
    manuscript_import: ManuscriptImportUseCases
    manuscript_export: ManuscriptExportUseCases
    backups: BackupUseCases
    history: HistoryUseCases
    assistant: AssistantAuditUseCases
    story_world: StoryWorldUseCases
    synchronization: SynchronizationUseCases


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
    selected_paths = persistence_paths or SQLitePaths.from_environment()
    worlds = SQLiteWorldRepository(selected_paths)
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
    synchronization = SynchronizationUseCases(
        worlds,
        documents,
        history,
        remote_backups,
        JsonSyncStateStore(lambda: worlds.data_directory / "synchronization"),
    )
    world_use_cases = WorldUseCases(worlds, observer)
    document_use_cases = DocumentUseCases(documents, local_backups, observer)
    place_map_use_cases = PlaceMapUseCases(SQLitePlaceMapRepository())
    return ApplicationServices(
        worlds=world_use_cases,
        documents=document_use_cases,
        place_maps=place_map_use_cases,
        example_worlds=ExampleWorldUseCases(
            world_use_cases, document_use_cases, place_map_use_cases, load_example_world
        ),
        project_transfer=ProjectTransferUseCases(
            SQLiteProjectTransferRepository(selected_paths), observer
        ),
        manuscript_import=ManuscriptImportUseCases(
            SQLiteManuscriptImportRepository(selected_paths), observer
        ),
        manuscript_export=ManuscriptExportUseCases(
            documents,
            lambda chapters, preset: (
                # ManuscriptExportUseCases validates the preset before it renders.
                serialize_docx(chapters, DocxExportOptions(preset=cast(DocxPreset, preset))).content
            ),
            lambda chapters, metadata, digest: (
                serialize_epub(
                    chapters,
                    EpubExportOptions(**metadata, identifier=f"urn:sha256:{digest}"),
                ).content
            ),
        ),
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
        synchronization=synchronization,
    )


def load_example_world(lang: str) -> ExampleWorldSource:
    """One language of the example world as the package ships it (T-214-4)."""

    document = json.loads(resources.example_world_document(lang).read_text(encoding="utf-8"))
    image = resources.example_world_file(str(document["mapImage"]["file"]))
    return ExampleWorldSource(document, image.read_bytes())


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


@dataclass(frozen=True, slots=True)
class LoggingConfig:
    level: str = "INFO"
    file: Path | None = None


_LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


def logging_config_from_env(environ: Mapping[str, str] | None = None) -> LoggingConfig:
    """QUILTOR_LOG_LEVEL and QUILTOR_LOG_FILE; a bad level raises instead of falling back,
    so a typo is noticed at start and not after the incident."""
    source = os.environ if environ is None else environ
    raw_level = source.get("QUILTOR_LOG_LEVEL", "").strip()
    level = raw_level.upper() if raw_level else "INFO"
    if level not in _LOG_LEVELS:
        raise ValueError(f"QUILTOR_LOG_LEVEL={raw_level!r} is not one of {', '.join(_LOG_LEVELS)}")
    raw_file = source.get("QUILTOR_LOG_FILE", "").strip()
    return LoggingConfig(level=level, file=Path(raw_file) if raw_file else None)


def _fail_start(message: str) -> NoReturn:
    print(f"quiltor: {message}", file=sys.stderr)
    raise SystemExit(2)


def build_observability(profile: BuildProfile | None = None) -> ObservabilityServices:
    selected = profile or current_profile()
    try:
        config = logging_config_from_env()
    except ValueError as error:
        _fail_start(str(error))
    try:
        if config.file is not None:
            config.file.parent.mkdir(parents=True, exist_ok=True)
        logger = StdlibStructuredLogger(level=config.level, file=config.file)
    except OSError as error:
        _fail_start(f"QUILTOR_LOG_FILE {str(config.file)!r} is not writable: {error.strerror}")
    logger.event(
        "info",
        "logging.configured",
        log_level=config.level.lower(),
        file=str(config.file) if config.file else None,
    )
    return ObservabilityServices(
        logger=logger,
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


def _premium_role(configured: str) -> str:
    """QUILTOR_PREMIUM_ROLE, or the default when unset or empty."""
    if not configured:
        return DEFAULT_PREMIUM_ROLE
    if len(configured) > 255 or any(character.isspace() for character in configured):
        raise RuntimeError("QUILTOR_PREMIUM_ROLE must be 1-255 characters without whitespace.")
    return configured


def build_identity(
    oidc_enabled: bool | None = None,
    *,
    gateway: IdentityGateway | None = None,
    issuer: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    master_token: str | None = None,
    render_tokens: RenderTokenStore | None = None,
    premium_role: str | None = None,
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
        return OidcIdentity(
            selected_gateway,
            selected_render_tokens,
            premium_role=_premium_role(
                premium_role
                if premium_role is not None
                else os.environ.get("QUILTOR_PREMIUM_ROLE", "")
            ),
        )
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


def assistant_client_job_slots(configured: str) -> int:
    """QUILTOR_ASSISTANT_CLIENT_JOBS: how many client-engine jobs run at once (T-61)."""
    configured = configured.strip()
    if not configured:
        return DEFAULT_CLIENT_JOB_SLOTS
    if not (configured.isascii() and configured.isdigit()) or not (
        1 <= int(configured) <= MAX_CLIENT_JOB_SLOTS
    ):
        raise RuntimeError(
            f"QUILTOR_ASSISTANT_CLIENT_JOBS must be a whole number from 1 to {MAX_CLIENT_JOB_SLOTS}."
        )
    return int(configured)


#: A client runtime estimates tokens without a tokenizer, so its cache stays small.
CLIENT_TOKEN_CACHE_BYTES = 256 * 1024


def client_runtime_factory(
    *,
    base: Path,
    data: Path,
    progress: Any,
    read_tools: Any,
    tickets: RelayTicketStore,
    debug_enabled: bool,
    token_cache: Callable[[], Any],
) -> Callable[[dict[str, Any], dict[str, Any]], AssistantRuntime]:
    """Build a runtime of its own for each client-engine job (T-61, F6).

    Its own token cache too (F-61-1): the shared cache keeps one identity and empties
    itself on every change, so a client job running beside the server would otherwise
    throw away the server's counts, and race them.
    """

    def build(job: dict[str, Any], request: dict[str, Any]) -> AssistantRuntime:
        engine = request.get("engine")
        if not isinstance(engine, dict):
            engine = {"kind": job.get("engine"), "grammar": False}
        return AssistantRuntime(
            base,
            data,
            RelayInferenceEngine(tickets, str(job["id"]), engine),
            progress=progress,
            read_tools=read_tools,
            token_cache=token_cache(),
            debug_enabled=debug_enabled,
        )

    return build


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
    progress = SQLiteAssistantProgressStore(data / "assistant-progress.sqlite3")
    read_tools = StoryWorldReadTools()
    debug_enabled = bool(os.environ.get("QUILTOR_AI_DEBUG"))
    runtime = AssistantRuntime(
        base,
        data,
        inference or LocalInferenceEngine(base, data, capabilities),
        progress=progress,
        read_tools=read_tools,
        token_cache=BoundedTokenCountCache(),
        debug_enabled=debug_enabled,
    )
    tickets = RelayTicketStore()
    interactions = LockedAssistantInteractionLogger(assistant, lock)
    jobs = AssistantJobRunner(
        runtime,
        store_factory=lambda: AssistantJobStore(data / "assistant-jobs.sqlite3"),
        interaction_logger=interactions,
        world_access=ApplicationAssistantWorldAccess(assistant),
        structured_logger=observability.logger,
        metrics=observability.metrics,
        client_runtime_factory=client_runtime_factory(
            base=base,
            data=data,
            progress=progress,
            read_tools=read_tools,
            tickets=tickets,
            debug_enabled=debug_enabled,
            # A fresh cache per job, never the server runtime's (F-61-1).
            token_cache=lambda: BoundedTokenCountCache(max_bytes=CLIENT_TOKEN_CACHE_BYTES),
        ),
        client_slots=assistant_client_job_slots(
            os.environ.get("QUILTOR_ASSISTANT_CLIENT_JOBS", "")
        ),
    )
    return AssistantServices(runtime, jobs, tickets)


def build_writing_assistance_service(
    data: Path, capabilities: FeatureAvailability
) -> WritingAssistanceService:
    return build_writing_assistance(data, capabilities)
