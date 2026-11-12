"""Explicit composition root for one isolated web-host instance."""

from __future__ import annotations

import json
import os
import re
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from quiltor import resources
from quiltor.application.backups import BackupAuthorization, WorldBackupContext
from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.application.documents import DocumentLocation
from quiltor.bootstrap.application import (
    ApplicationServices,
    AssistantServices,
    ObservabilityServices,
    build_application_services,
    build_assistant_installation,
    build_assistant_services,
    build_backup_authorizer,
    build_feature_availability,
    build_identity,
    build_observability,
    build_writing_assistance_service,
)
from quiltor.infrastructure.backup.authorization import EndpointBoundBackupAuthorizer
from quiltor.infrastructure.pdf import unavailable
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from quiltor.infrastructure.platform.ports import AppDirectories
from quiltor.infrastructure.platform.runtime_target import ProcessRole, current_target
from quiltor.modules.assistant.ports import AssistantInstallation, InferenceEngine
from quiltor.modules.identity.auth import SessionData
from quiltor.modules.identity.service import Identity
from quiltor.modules.writing_assistance import WritingAssistanceService

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


@dataclass(frozen=True, slots=True)
class WebWorldContext:
    id: str
    document_location: DocumentLocation
    backup: WorldBackupContext
    # An unchanged preview of the example world (T-214-5a). The first change a route writes
    # makes it real; sync and backups refuse it until then.
    preview: bool = False

    @property
    def db_path(self) -> Path:
        return self.document_location.database

    @property
    def backups_dir(self) -> Path:
        return self.document_location.backups

    @property
    def manuscripts_dir(self) -> Path:
        return self.document_location.manuscript_mirrors

    @property
    def profiles_dir(self) -> Path:
        return self.document_location.story_world_mirrors


@dataclass(frozen=True, slots=True)
class WorldRouteServices:
    worlds: Any
    lock: threading.Lock
    syncable: bool = True
    example_worlds: Any = None


@dataclass(frozen=True, slots=True)
class DocumentRouteServices:
    documents: Any
    lock: threading.Lock
    render_pdf: Callable[[str], bytes]
    issue_render_token: Callable[[str], str]
    # A preview's first saved change makes it a real world with a title of its own.
    finish_promotion: Callable[[str], Mapping[str, Any]] = lambda _world_id: {}


@dataclass(frozen=True, slots=True)
class ManuscriptExportRouteServices:
    manuscript_export: Any
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class AssistantRouteServices:
    documents: Any
    story_world: Any
    audit: Any
    assistant: Any
    assistant_jobs: Any
    assistant_installation: AssistantInstallation
    lock: threading.Lock
    identity: Identity
    # None where one person owns the server: the limit only protects a shared one.
    max_open_jobs: int | None
    installable: bool = True
    # Whether jobs may name a client engine (T-61, QUILTOR_ASSISTANT_CLIENT_AI).
    client_ai: bool = True
    # Hands the model calls of client-engine jobs to the browser (T-61).
    relay_tickets: Any = None


@dataclass(frozen=True, slots=True)
class BackupRouteServices:
    backups: Any
    worlds: Any
    identity: Identity
    observability: ObservabilityServices
    lock: threading.Lock
    backup_authorization: Callable[[str, SessionData | None], BackupAuthorization]
    syncable: bool = True


@dataclass(frozen=True, slots=True)
class SynchronizationRouteServices:
    synchronization: Any
    lock: threading.Lock
    backup_authorization: Callable[[str, SessionData | None], BackupAuthorization]
    worlds: Any = None
    default_endpoint: Callable[[], str] = lambda: ""


@dataclass(frozen=True, slots=True)
class PlaceMapRouteServices:
    place_maps: Any
    observability: ObservabilityServices
    lock: threading.Lock
    finish_promotion: Callable[[str], Mapping[str, Any]] = lambda _world_id: {}


@dataclass(frozen=True, slots=True)
class ProjectTransferRouteServices:
    project_transfer: Any
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class ManuscriptImportRouteServices:
    manuscript_import: Any
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class HistoryRouteServices:
    history: Any
    lock: threading.Lock
    # The one write the history routes have (T-87 B): putting a version back. Only
    # that bound use case, not the whole backups slice, so the routes stay narrow.
    restore_version: Any = None
    finish_promotion: Callable[[str], Mapping[str, Any]] = lambda _world_id: {}


@dataclass(frozen=True, slots=True)
class IdentityRouteServices:
    identity: Identity
    observability: ObservabilityServices
    version: str
    syncable: bool = True


@dataclass(frozen=True, slots=True)
class WritingAssistanceRouteServices:
    writing_assistance: WritingAssistanceService
    installable: bool = True
    grammar_installable: bool = True


@dataclass(frozen=True, slots=True)
class CapabilitiesRouteServices:
    """The facts GET /api/capabilities reports, already decided (T-102)."""

    multi_user: bool
    syncable: bool
    assistant_install: bool
    writing_data_install: bool
    grammar_install: bool
    # Per session: may this account use the server-side assistant (T-58).
    is_premium: Callable[[SessionData], bool] = lambda session: True
    # May a job run on the user's own engine (QUILTOR_ASSISTANT_CLIENT_AI, T-61).
    client_ai: bool = False
    # QUILTOR_TEST_HOOKS=1 only: the client may offer its test profile (T-61 part 6/8).
    test_hooks: bool = False


DEFAULT_ASSISTANT_MAX_OPEN_JOBS = 3
MAX_ASSISTANT_MAX_OPEN_JOBS = 100


def assistant_client_ai(configured: str) -> bool:
    """QUILTOR_ASSISTANT_CLIENT_AI: `1` or unset lets users run jobs on their own engine,
    `0` does not. On by default since the relay routes exist (T-61 Teil 3)."""
    configured = configured.strip()
    if configured == "0":
        return False
    if configured in {"", "1"}:
        return True
    raise RuntimeError("QUILTOR_ASSISTANT_CLIENT_AI must be 0 or 1.")


def assistant_max_open_jobs(configured: str) -> int:
    """QUILTOR_ASSISTANT_MAX_OPEN_JOBS, or the default when unset or empty."""
    configured = configured.strip()
    if not configured:
        return DEFAULT_ASSISTANT_MAX_OPEN_JOBS
    if not (configured.isascii() and configured.isdigit()) or not (
        1 <= int(configured) <= MAX_ASSISTANT_MAX_OPEN_JOBS
    ):
        raise RuntimeError(
            "QUILTOR_ASSISTANT_MAX_OPEN_JOBS must be a whole number from 1 to "
            f"{MAX_ASSISTANT_MAX_OPEN_JOBS}."
        )
    return int(configured)


CSP_POLICY_FILE = Path(__file__).with_name("csp-policy.json")
CSP_MODES = ("report-only", "enforce", "off")
DEFAULT_CSP_MODE = "report-only"
_CSP_ORIGIN = re.compile(r"https://[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::[0-9]{1,5})?")


def csp_mode(configured: str) -> str:
    """QUILTOR_CSP: `report-only` (the default), `enforce` or `off`."""
    configured = configured.strip()
    if not configured:
        return DEFAULT_CSP_MODE
    if configured not in CSP_MODES:
        raise RuntimeError("QUILTOR_CSP must be report-only, enforce or off.")
    return configured


def csp_connect_extra(configured: str) -> tuple[str, ...]:
    """QUILTOR_CSP_CONNECT_EXTRA: space-separated https:// origins, no path, no wildcard."""
    origins = tuple(configured.split())
    for origin in origins:
        if not _CSP_ORIGIN.fullmatch(origin):
            raise RuntimeError(
                "QUILTOR_CSP_CONNECT_EXTRA must list https:// origins separated by spaces, "
                f"without path or wildcard: {origin!r}"
            )
    return origins


def content_security_policy(
    mode: str, *, connect_extra: tuple[str, ...] = (), test_hooks: bool = False
) -> tuple[str, str] | None:
    """The header name and value every HTML answer carries, or None when switched off.

    No report-uri: violations are seen in the browser console and by the product suite.
    """
    if mode == "off":
        return None
    policy = json.loads(CSP_POLICY_FILE.read_text(encoding="utf-8"))
    directives = {name: list(values) for name, values in policy["directives"].items()}
    directives["connect-src"] += policy["webllmHosts"]
    if test_hooks:
        directives["connect-src"].append(policy["testHooksOrigin"])
    directives["connect-src"] += list(connect_extra)
    value = "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())
    name = "Content-Security-Policy" if mode == "enforce" else "Content-Security-Policy-Report-Only"
    return name, value


HOSTED = "hosted"
DESKTOP = "desktop"
LOCAL = "local"


def operation_profile_for(*, multi_user: bool, process_role: ProcessRole | None) -> str:
    """How this instance is operated, which decides who may install software (D-59).

    `hosted` is exactly the multi-user (OIDC) deployment: several people share one
    server, so downloading runtimes, models or dictionaries belongs to its operator.
    There is deliberately no loopback criterion and no environment switch.
    """

    if multi_user:
        return HOSTED
    if process_role is ProcessRole.DESKTOP:
        return DESKTOP
    return LOCAL


def assistant_installable(app: WebApplication) -> bool:
    """Whether a request may install the assistant runtime and model (T-101).

    The status route and GET /api/capabilities both report this, so the two
    answers cannot drift apart (T-102).

    Both axes count as well (T-102 D2, D-105 F7): without them the install
    route starts nothing (`LocalAssistantInstallation.start_async` answers
    False), so offering the button would be a promise the server cannot keep.
    The Docker profile `web-self-hosted` is such a server (A-5 2.1).
    """
    return (
        app.installable
        and app.capabilities.is_available(Feature.LOCAL_INFERENCE)
        and app.capabilities.is_available(Feature.CODE_DOWNLOAD)
    )


def writing_data_installable(app: WebApplication) -> bool:
    """Whether a request may install the dictionary data (T-101, T-102)."""
    return app.installable


def grammar_installable(app: WebApplication) -> bool:
    """Whether a request may install LanguageTool (T-101, T-102)."""
    return app.installable


@dataclass(slots=True)
class WebApplication:
    """All state owned by one HTTP server instance, never by a module import."""

    application: ApplicationServices
    capabilities: FeatureAvailability
    identity: Identity
    assistant_services: AssistantServices
    assistant_installation: AssistantInstallation
    writing_assistance: WritingAssistanceService
    observability: ObservabilityServices
    backup_authorizer: EndpointBoundBackupAuthorizer
    render_pdf: Callable[[str], bytes]
    public_assets: Path
    version: str
    public_url: str
    bound_to_loopback: bool
    lock: threading.Lock
    operation_profile: str = LOCAL
    # How many queued or running assistant jobs one account may have (OIDC only).
    assistant_max_open_jobs: int = DEFAULT_ASSISTANT_MAX_OPEN_JOBS
    # Whether a job may name a client engine (QUILTOR_ASSISTANT_CLIENT_AI, T-61).
    assistant_client_ai: bool = True
    # Header for every text/html answer (QUILTOR_CSP, T-61); None sends none.
    content_security_policy: tuple[str, str] | None = None
    # QUILTOR_TEST_HOOKS=1, read from the environment only, never from a request (T-61).
    test_hooks: bool = False

    @property
    def installable(self) -> bool:
        """Whether a request may install software on this server."""
        return self.operation_profile != HOSTED

    @property
    def syncable(self) -> bool:
        """Whether worlds on this server may sync with another device (D-61).

        A hosted server is the shared storage itself. Routes ask this, never
        `multi_user`, so the rule lives in one place.
        """
        return self.operation_profile != HOSTED

    @property
    def assistant(self):
        return self.assistant_services.runtime

    @property
    def assistant_jobs(self):
        return self.assistant_services.jobs

    @property
    def data_directory(self) -> Path:
        return self.application.worlds.data_directory

    @property
    def backups_directory(self) -> Path:
        return self.data_directory / "backups"

    def prepare(self) -> None:
        self.application.worlds.prepare()

    def resolve_world(self, session: SessionData, world_id: str) -> WebWorldContext:
        opened = self.application.worlds.open(world_id, session.sub)
        location = opened.paths.documents
        context = self.application.backups.context(
            world_id,
            opened.summary.backup_url,
            location,
            title=opened.summary.title,
        )
        return WebWorldContext(world_id, location, context, preview=opened.summary.preview)

    def issue_render_token(self, subject: str) -> str:
        return self.identity.issue_render_token(subject)

    def redeem_render_token(self, token: str) -> str | None:
        return self.identity.redeem_render_token(token)

    def backup_authorization(
        self, base_url: str, session: SessionData | None
    ) -> BackupAuthorization:
        # A hosted server offers no device sync (D-61), so no route reaches this there
        # (T-87 S). Refuse rather than fall back to the local login: that credential
        # belongs to whoever runs the process, not to the person asking (T-157).
        if self.identity.multi_user:
            raise PermissionError("Device sync is not offered on a hosted server.")
        return self.backup_authorizer.authorize_local(base_url)

    def close(self) -> None:
        self.assistant_jobs.close()
        self.assistant.close()
        self.writing_assistance.close()

    def route_services(self, path: str):
        """Expose only the capabilities owned by the selected route context."""

        if path.startswith("/api/worlds"):
            return WorldRouteServices(
                self.application.worlds,
                self.lock,
                self.syncable,
                self.application.example_worlds,
            )
        if path in {"/api/state", "/api/manuscript", "/api/storyboards", "/api/book.pdf"}:
            return DocumentRouteServices(
                self.application.documents,
                self.lock,
                self.render_pdf,
                self.issue_render_token,
                self.application.worlds.finish_promotion,
            )
        if path.startswith("/api/assistant"):
            return AssistantRouteServices(
                self.application.documents,
                self.application.story_world,
                self.application.assistant,
                self.assistant,
                self.assistant_jobs,
                self.assistant_installation,
                self.lock,
                self.identity,
                self.assistant_max_open_jobs if self.identity.multi_user else None,
                assistant_installable(self),
                self.assistant_client_ai,
                self.assistant_services.relay_tickets,
            )
        if path.startswith("/api/sync"):
            return SynchronizationRouteServices(
                self.application.synchronization,
                self.lock,
                self.backup_authorization,
                self.application.worlds,
                self.application.backups.default_endpoint,
            )
        if path.startswith("/api/backup") or path == "/backup/callback":
            return BackupRouteServices(
                self.application.backups,
                self.application.worlds,
                self.identity,
                self.observability,
                self.lock,
                self.backup_authorization,
                self.syncable,
            )
        if path.startswith("/api/place-map"):
            return PlaceMapRouteServices(
                self.application.place_maps,
                self.observability,
                self.lock,
                self.application.worlds.finish_promotion,
            )
        if path.startswith("/api/project-transfer"):
            return ProjectTransferRouteServices(self.application.project_transfer, self.lock)
        if path.startswith("/api/manuscript-import"):
            return ManuscriptImportRouteServices(self.application.manuscript_import, self.lock)
        if path.startswith("/api/manuscript-export"):
            return ManuscriptExportRouteServices(self.application.manuscript_export, self.lock)
        if path.startswith("/api/history"):
            return HistoryRouteServices(
                self.application.history,
                self.lock,
                self.application.backups.restore_version,
                self.application.worlds.finish_promotion,
            )
        if path.startswith("/api/writing-assistance"):
            return WritingAssistanceRouteServices(
                self.writing_assistance,
                writing_data_installable(self),
                grammar_installable(self),
            )
        if path == "/api/capabilities":
            return CapabilitiesRouteServices(
                self.identity.multi_user,
                self.syncable,
                assistant_installable(self),
                writing_data_installable(self),
                grammar_installable(self),
                self.identity.is_premium,
                client_ai=self.assistant_client_ai,
                test_hooks=self.test_hooks,
            )
        return IdentityRouteServices(self.identity, self.observability, self.version, self.syncable)


def _validated_public_url(identity: Identity) -> str:
    public_url = os.environ.get("QUILTOR_PUBLIC_URL", "").rstrip("/")
    if not identity.multi_user:
        return public_url
    if not public_url:
        raise RuntimeError("QUILTOR_PUBLIC_URL is required when OIDC is enabled.")
    parts = urlparse(public_url)
    insecure_loopback = (
        parts.scheme == "http"
        and (parts.hostname or "").lower() in LOOPBACK_HOSTS
        and os.environ.get("QUILTOR_OIDC_ALLOW_INSECURE_LOOPBACK", "") == "1"
    )
    if (
        (parts.scheme != "https" and not insecure_loopback)
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
    ):
        raise RuntimeError("QUILTOR_PUBLIC_URL must be a trusted HTTPS base URL.")
    if parts.scheme == "https" and os.environ.get("QUILTOR_COOKIE_SECURE", "auto") == "0":
        raise RuntimeError("Secure session cookies cannot be disabled for an HTTPS public URL.")
    return public_url


def build_web_application(
    *,
    identity: Identity | None = None,
    render_pdf: Callable[[str], bytes] | None = None,
    ensure_assistant_installed: bool = False,
    inference: InferenceEngine | None = None,
    app_directories: AppDirectories | None = None,
) -> WebApplication:
    """Build one independent web runtime; calling this is the stateful action."""

    base = resources.source_root()
    capabilities = build_feature_availability()
    observability = build_observability()
    persistence_paths = (
        SQLitePaths.from_data_directory(app_directories.data)
        if app_directories is not None
        else SQLitePaths.from_environment()
    )
    application = build_application_services(
        capabilities, observability, persistence_paths=persistence_paths
    )
    selected_identity = identity or build_identity()
    public_url = _validated_public_url(selected_identity)
    lock = threading.Lock()
    runtime_home = (
        app_directories.data.parent
        if app_directories is not None
        else Path(os.environ.get("QUILTOR_HOME", str(base)))
    )
    installation = build_assistant_installation(capabilities, runtime_home)
    if ensure_assistant_installed:
        installation.ensure_installed()
    assistant = build_assistant_services(
        base=runtime_home,
        data=application.worlds.data_directory,
        assistant=application.assistant,
        lock=lock,
        observability=observability,
        capabilities=capabilities,
        inference=inference,
    )
    backup_authorizer = build_backup_authorizer(application.backups)
    version_file = resources.version_file()
    version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "dev"
    test_hooks = os.environ.get("QUILTOR_TEST_HOOKS", "") == "1"
    return WebApplication(
        application=application,
        capabilities=capabilities,
        identity=selected_identity,
        assistant_services=assistant,
        assistant_installation=installation,
        writing_assistance=build_writing_assistance_service(
            application.worlds.data_directory, capabilities
        ),
        observability=observability,
        backup_authorizer=backup_authorizer,
        render_pdf=render_pdf or unavailable.render,
        public_assets=resources.web_assets(),
        version=version,
        public_url=public_url,
        bound_to_loopback=(os.environ.get("QUILTOR_HOST", "127.0.0.1") in LOOPBACK_HOSTS),
        lock=lock,
        operation_profile=operation_profile_for(
            multi_user=selected_identity.multi_user,
            process_role=current_target().process_role,
        ),
        assistant_max_open_jobs=assistant_max_open_jobs(
            os.environ.get("QUILTOR_ASSISTANT_MAX_OPEN_JOBS", "")
        ),
        assistant_client_ai=assistant_client_ai(os.environ.get("QUILTOR_ASSISTANT_CLIENT_AI", "")),
        content_security_policy=content_security_policy(
            csp_mode(os.environ.get("QUILTOR_CSP", "")),
            connect_extra=csp_connect_extra(os.environ.get("QUILTOR_CSP_CONNECT_EXTRA", "")),
            test_hooks=test_hooks,
        ),
        test_hooks=test_hooks,
    )


__all__ = [
    "LOOPBACK_HOSTS",
    "AssistantRouteServices",
    "BackupRouteServices",
    "DocumentRouteServices",
    "IdentityRouteServices",
    "ManuscriptImportRouteServices",
    "ProjectTransferRouteServices",
    "SynchronizationRouteServices",
    "WebApplication",
    "WebWorldContext",
    "WorldRouteServices",
    "WritingAssistanceRouteServices",
    "build_web_application",
    "operation_profile_for",
]
