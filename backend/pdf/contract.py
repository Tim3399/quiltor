"""What a PDF renderer has to provide.

All three take a URL that renders the book layout and return the finished PDF
bytes. They differ only in what drives the rendering, which is a host and
edition decision -- see this package's __init__.

The URL, not the manuscript: every renderer loads the app's own print view over
loopback rather than re-implementing the 6 x 9 inch book layout. That layout
lives in CSS, in one place, and is what the reader actually sees.
"""
from __future__ import annotations

from typing import Protocol


class PdfRenderer(Protocol):
    def __call__(self, url: str, timeout: int = 90) -> bytes:
        """Render `url` to PDF bytes, or raise with a message fit to show a user."""
