"""Host capabilities consumed by Quiltor's application modules."""

from quiltor.infrastructure.platform.ports.authentication import AuthSession
from quiltor.infrastructure.platform.ports.credentials import CredentialVault, CredentialVaultError
from quiltor.infrastructure.platform.ports.directories import AppDirectories
from quiltor.infrastructure.platform.ports.documents import DocumentAccess
from quiltor.infrastructure.platform.ports.pdf import PdfRenderer
from quiltor.infrastructure.platform.ports.processes import ProcessSupervisor
from quiltor.infrastructure.platform.ports.system import SystemAdapter
from quiltor.infrastructure.platform.ports.updates import UpdateProvider, UpdateStatus

__all__ = [
    "AppDirectories",
    "AuthSession",
    "CredentialVault",
    "CredentialVaultError",
    "DocumentAccess",
    "PdfRenderer",
    "ProcessSupervisor",
    "SystemAdapter",
    "UpdateProvider",
    "UpdateStatus",
]
