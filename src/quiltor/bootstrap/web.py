"""Explicit composition root for one isolated web-host instance."""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from quiltor import resources
from quiltor.application.backups import BackupAuthorization, WorldBackupContext
from quiltor.application.capabilities import FeatureAvailability
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
from quiltor.modules.assistant.ports import AssistantInstallation, InferenceEngine
from quiltor.modules.identity.auth import SessionData
from quiltor.modules.identity.service import Identity
from quiltor.modules.writing_assistance import WritingAssistanceService

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
TOKEN_LEEWAY = 30


@dataclass(frozen=True, slots=True)
class WebWorldContext:
    id: str
    document_location: DocumentLocation
    backup: WorldBackupContext

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


@dataclass(frozen=True, slots=True)
class DocumentRouteServices:
    documents: Any
    lock: threading.Lock
    render_pdf: Callable[[str], bytes]
    issue_render_token: Callable[[str], str]


@dataclass(frozen=True, slots=True)
class AssistantRouteServices:
    documents: Any
    story_world: Any
    audit: Any
    assistant: Any
    assistant_jobs: Any
    assistant_installation: AssistantInstallation
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class BackupRouteServices:
    backups: Any
    worlds: Any
    identity: Identity
    observability: ObservabilityServices
    lock: threading.Lock
    backup_authorization: Callable[[str, SessionData | None], BackupAuthorization]
    session_backup_token: Callable[[SessionData | None], str]


@dataclass(frozen=True, slots=True)
class PlaceMapRouteServices:
    place_maps: Any
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class HistoryRouteServices:
    history: Any
    lock: threading.Lock


@dataclass(frozen=True, slots=True)
class IdentityRouteServices:
    identity: Identity
    observability: ObservabilityServices
    version: str


@dataclass(frozen=True, slots=True)
class WritingAssistanceRouteServices:
    writing_assistance: WritingAssistanceService


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
        return WebWorldContext(world_id, location, context)

    def issue_render_token(self, subject: str) -> str:
        return self.identity.issue_render_token(subject)

    def redeem_render_token(self, token: str) -> str | None:
        return self.identity.redeem_render_token(token)

    def session_backup_token(self, session: SessionData | None) -> str:
        if session is None:
            return ""
        return self.identity.auth.session_access_token(session.session_id, leeway=TOKEN_LEEWAY)

    def backup_authorization(
        self, base_url: str, session: SessionData | None
    ) -> BackupAuthorization:
        if self.identity.multi_user:
            return self.backup_authorizer.authorize_hosted(
                base_url, self.session_backup_token(session)
            )
        return self.backup_authorizer.authorize_local(base_url)

    def close(self) -> None:
        self.assistant_jobs.close()
        self.assistant.close()
        self.writing_assistance.close()

    def route_services(self, path: str):
        """Expose only the capabilities owned by the selected route context."""

        if path.startswith("/api/worlds"):
            return WorldRouteServices(self.application.worlds, self.lock)
        if path in {"/api/state", "/api/manuscript", "/api/storyboards", "/api/book.pdf"}:
            return DocumentRouteServices(
                self.application.documents,
                self.lock,
                self.render_pdf,
                self.issue_render_token,
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
            )
        if path.startswith("/api/backup") or path == "/backup/callback":
            return BackupRouteServices(
                self.application.backups,
                self.application.worlds,
                self.identity,
                self.observability,
                self.lock,
                self.backup_authorization,
                self.session_backup_token,
            )
        if path.startswith("/api/place-map"):
            return PlaceMapRouteServices(self.application.place_maps, self.lock)
        if path.startswith("/api/history"):
            return HistoryRouteServices(self.application.history, self.lock)
        if path.startswith("/api/writing-assistance"):
            return WritingAssistanceRouteServices(self.writing_assistance)
        return IdentityRouteServices(self.identity, self.observability, self.version)


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
    ensure_assistant_installed: bool = True,
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
    backup_authorizer = build_backup_authorizer(
        application.backups,
        expected_hosted_issuer=(
            selected_identity.auth.issuer if selected_identity.multi_user else ""
        ),
    )
    version_file = resources.version_file()
    version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "dev"
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
    )


__all__ = [
    "AssistantRouteServices",
    "BackupRouteServices",
    "DocumentRouteServices",
    "IdentityRouteServices",
    "LOOPBACK_HOSTS",
    "WebApplication",
    "WebWorldContext",
    "WorldRouteServices",
    "WritingAssistanceRouteServices",
    "build_web_application",
]
