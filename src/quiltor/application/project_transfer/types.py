from __future__ import annotations

from dataclasses import dataclass

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ProjectTransferPreview:
    title: str
    chapters: int
    book_chapters: int
    set_aside_chapters: int
    trashed_chapters: int
    figures: int
    storyboards: int
    images: int

    def public(self) -> dict:
        return {
            "title": self.title,
            "counts": {
                "chapters": self.chapters,
                "bookChapters": self.book_chapters,
                "setAsideChapters": self.set_aside_chapters,
                "trashedChapters": self.trashed_chapters,
                "figures": self.figures,
                "storyboards": self.storyboards,
                "images": self.images,
            },
            "includes": {"trash": True, "history": False},
        }


__all__ = ["MAX_ARCHIVE_BYTES", "ProjectTransferPreview"]
