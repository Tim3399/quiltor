from quiltor.application.errors import (
    ApplicationConflict,
    ApplicationUnavailable,
    InvalidApplicationInput,
)


class InvalidManuscriptFile(InvalidApplicationInput):
    code = "manuscript_import.invalid_file"


class ManuscriptLimitExceeded(InvalidManuscriptFile):
    code = "manuscript_import.limit_exceeded"


class UnsupportedManuscriptContent(InvalidManuscriptFile):
    code = "manuscript_import.unsupported_content"


class InvalidManuscriptSelection(InvalidApplicationInput):
    code = "manuscript_import.invalid_selection"


class ManuscriptPreviewMismatch(InvalidApplicationInput):
    code = "manuscript_import.preview_mismatch"


class ManuscriptWarningsUnacknowledged(InvalidApplicationInput):
    code = "manuscript_import.warnings_unacknowledged"


class ConflictingManuscriptRequest(ApplicationConflict):
    code = "manuscript_import.conflicting_request"


class ManuscriptPublicationFailed(ApplicationUnavailable):
    code = "manuscript_import.publication_failed"


__all__ = [
    "ConflictingManuscriptRequest",
    "InvalidManuscriptFile",
    "InvalidManuscriptSelection",
    "ManuscriptLimitExceeded",
    "ManuscriptPreviewMismatch",
    "ManuscriptPublicationFailed",
    "ManuscriptWarningsUnacknowledged",
    "UnsupportedManuscriptContent",
]
