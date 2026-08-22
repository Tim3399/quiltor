"""Composition roots for Quiltor hosts."""

from quiltor.bootstrap.application import (
    ApplicationServices,
    McpApplicationServices,
    AssistantServices,
    ObservabilityServices,
    build_application_services,
    build_mcp_application_services,
    build_backup_authorizer,
    build_assistant_installation,
    build_assistant_services,
    build_feature_availability,
    build_identity,
    build_observability,
    build_writing_assistance_service,
)
from quiltor.bootstrap.web import (
    LOOPBACK_HOSTS,
    WebApplication,
    WebWorldContext,
    build_web_application,
)

__all__ = [
    "ApplicationServices",
    "McpApplicationServices",
    "AssistantServices",
    "ObservabilityServices",
    "build_application_services",
    "build_mcp_application_services",
    "build_backup_authorizer",
    "build_assistant_installation",
    "build_assistant_services",
    "build_feature_availability",
    "build_identity",
    "build_observability",
    "build_writing_assistance_service",
    "WebApplication",
    "WebWorldContext",
    "LOOPBACK_HOSTS",
    "build_web_application",
]
