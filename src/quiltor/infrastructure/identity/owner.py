"""Owner identity backed by the established SQLite persistence contract."""

from quiltor.infrastructure.persistence.sqlite import config


class SQLiteOwnerIdentityStore:
    @property
    def local_owner_id(self) -> str:
        return config.LOCAL_OWNER


__all__ = ["SQLiteOwnerIdentityStore"]
