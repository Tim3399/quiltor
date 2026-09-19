from quiltor.application.errors import ApplicationUnavailable, InvalidApplicationInput


class InvalidProjectArchive(InvalidApplicationInput):
    code = "project_transfer.invalid_archive"


class UnsupportedProjectArchive(InvalidProjectArchive):
    code = "project_transfer.unsupported_version"


class ProjectArchiveLimitExceeded(InvalidProjectArchive):
    code = "project_transfer.limit_exceeded"


class InvalidProjectAsset(InvalidProjectArchive):
    code = "project_transfer.invalid_asset"


class ProjectPublicationFailed(ApplicationUnavailable):
    code = "project_transfer.publication_failed"


__all__ = [
    "InvalidProjectArchive",
    "InvalidProjectAsset",
    "ProjectArchiveLimitExceeded",
    "ProjectPublicationFailed",
    "UnsupportedProjectArchive",
]
