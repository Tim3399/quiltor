"""Composition roots for Quiltor hosts."""

from quiltor.bootstrap.application import (
    ApplicationServices,
    AssistantServices,
    McpApplicationServices,
    ObservabilityServices,
    build_application_services,
    build_assistant_installation,
    build_assistant_services,
    build_backup_authorizer,
    build_feature_availability,
    build_identity,
    build_mcp_application_services,
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
    "LOOPBACK_HOSTS",
    "ApplicationServices",
    "AssistantServices",
    "McpApplicationServices",
    "ObservabilityServices",
    "WebApplication",
    "WebWorldContext",
    "build_application_services",
    "build_assistant_installation",
    "build_assistant_services",
    "build_backup_authorizer",
    "build_feature_availability",
    "build_identity",
    "build_mcp_application_services",
    "build_observability",
    "build_web_application",
    "build_writing_assistance_service",
]
