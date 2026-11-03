"""Expected writing-assistance failures, each with its own stable error code.

The client maps these codes to German text. Before they existed, a missing Java,
an unreachable download and a server that would not start all reached the user
as the same "could not be run" message.
"""

from __future__ import annotations

from quiltor.application.errors import (
    ApplicationConflict,
    ApplicationGatewayError,
    ApplicationUnavailable,
)


class JavaMissing(ApplicationConflict):
    """No Java of the required version on this machine. Installing Java is up
    to the user, so retrying the same request cannot help."""

    code = "writing_assistance.java_missing"
    retryable = False


class DownloadFailed(ApplicationGatewayError):
    """The LanguageTool download did not arrive. 502: the request was fine and
    so is Quiltor; the remote end failed. Often temporary, so retryable."""

    code = "writing_assistance.download_failed"
    retryable = True


class ChecksumMismatch(ApplicationGatewayError):
    """The download arrived but is not the pinned archive. 502 as well -- the
    remote end delivered the wrong bytes -- but not retryable: against a pinned
    checksum, the same URL keeps returning the same wrong file."""

    code = "writing_assistance.checksum_mismatch"
    retryable = False


class GrammarStartFailed(ApplicationUnavailable):
    """LanguageTool is installed but its server did not come up."""

    code = "writing_assistance.grammar_start_failed"


class GrammarUnavailable(ApplicationUnavailable):
    """The grammar server did not answer usefully: unreachable, a 5xx, a timeout
    or a reply that is not LanguageTool JSON. Same code the check route already
    used for its catch-all, so the client text stays the same."""

    code = "writing_assistance.grammar_unavailable"


class InstallInProgress(ApplicationConflict):
    """Another request is installing the language data right now. 409 and
    retryable: once that one finishes, the data is there or a retry can start."""

    code = "writing_assistance.install_in_progress"
    retryable = True


class DataNotPublished(ApplicationConflict):
    """This release ships without a published dictionary asset, so there is
    nothing to download. Not retryable: the same version stays unpublished."""

    code = "writing_assistance.data_not_published"
    retryable = False


__all__ = [
    "ChecksumMismatch",
    "DataNotPublished",
    "DownloadFailed",
    "GrammarStartFailed",
    "GrammarUnavailable",
    "InstallInProgress",
    "JavaMissing",
]
