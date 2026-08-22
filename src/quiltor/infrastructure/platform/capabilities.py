"""Distribution policy questions consumed by application capabilities."""

from quiltor.infrastructure.platform.runtime_target import constraints, is_store_distribution


def is_sandboxed() -> bool:
    return constraints().sandboxed


def allows_code_download() -> bool:
    return constraints().allows_code_download


def allows_external_process() -> bool:
    return constraints().allows_external_process


def allows_self_update() -> bool:
    return constraints().allows_self_update


def allows_arbitrary_file_access() -> bool:
    return constraints().allows_arbitrary_file_access


__all__ = [
    "allows_arbitrary_file_access",
    "allows_code_download",
    "allows_external_process",
    "allows_self_update",
    "is_sandboxed",
    "is_store_distribution",
]
