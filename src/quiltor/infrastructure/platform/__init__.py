"""Stable boundary between Quiltor capabilities and their running host.

There is deliberately no all-knowing ``Platform`` object.  Callers depend on a
small port (credential vault, process supervisor, document access, …) or on the
immutable runtime/build-profile values.
"""

from __future__ import annotations

from quiltor.infrastructure.platform import capabilities, directories, system
from quiltor.infrastructure.platform.adapters.authentication import SystemBrowserAuthSession
from quiltor.infrastructure.platform.adapters.credentials import default_credential_vault
from quiltor.infrastructure.platform.adapters.documents import LocalDocumentAccess
from quiltor.infrastructure.platform.adapters.processes import NativeProcessSupervisor
from quiltor.infrastructure.platform.adapters.updates import NoUpdateProvider
from quiltor.infrastructure.platform.runtime_target import (
    Architecture,
    BuildProfile,
    DistributionChannel,
    DistributionConstraints,
    HostKind,
    PlatformKind,
    ProcessRole,
    RuntimeTarget,
    current_profile,
    current_target,
)

_process_supervisor = NativeProcessSupervisor()
_document_access = LocalDocumentAccess()
_auth_session = SystemBrowserAuthSession()
_update_provider = NoUpdateProvider()


def process_supervisor() -> NativeProcessSupervisor:
    return _process_supervisor


def document_access() -> LocalDocumentAccess:
    return _document_access


def auth_session() -> SystemBrowserAuthSession:
    return _auth_session


def update_provider() -> NoUpdateProvider:
    return _update_provider


__all__ = [
    "Architecture",
    "BuildProfile",
    "DistributionChannel",
    "DistributionConstraints",
    "HostKind",
    "PlatformKind",
    "ProcessRole",
    "RuntimeTarget",
    "auth_session",
    "capabilities",
    "current_profile",
    "current_target",
    "default_credential_vault",
    "directories",
    "document_access",
    "process_supervisor",
    "system",
    "update_provider",
]
