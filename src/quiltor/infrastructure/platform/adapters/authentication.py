"""System-browser authentication adapter for desktop/CLI hosts."""

from __future__ import annotations

import webbrowser


class SystemBrowserAuthSession:
    def open(self, authorization_url: str) -> None:
        if not webbrowser.open(authorization_url):
            raise RuntimeError("The system browser could not be opened for sign-in.")


__all__ = ["SystemBrowserAuthSession"]
