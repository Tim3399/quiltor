"""Stable application failures owned by version-history reads."""

from quiltor.application.errors import ApplicationNotFound, InvalidApplicationInput


class HistoryRequestInvalid(InvalidApplicationInput):
    code = "history.request_invalid"


class HistoryRevisionNotFound(ApplicationNotFound):
    code = "history.revision_not_found"


__all__ = ["HistoryRequestInvalid", "HistoryRevisionNotFound"]
