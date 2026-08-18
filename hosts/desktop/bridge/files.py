"""Saving an export to a place the user picked.

Why the page does not just download the file itself
---------------------------------------------------
All five exports (book PDF, whole manuscript, one chapter, figures JSON,
character profiles) are blob URLs behind an `<a download>` (src/lib/api.ts).
A WebView refuses those unless downloads are switched on, and pywebview's own
download handling is not usable on macOS. In webview/platforms/cocoa.py,

    DownloadDelegate.download_decideDestinationUsingResponse_
                     suggestedFilename_completionHandler_

runs an application-modal NSSavePanel from inside WebKit's download callback and
then calls `completionHandler(url)`. That delegate is a plain pyobjc NSObject
subclass with no selector metadata, so the block argument arrives with
`__block_signature__ == None` and the call raises

    TypeError: cannot call block without a signature

The panel is already up and app-modal when this happens, so the user is looking
at a save dialog that cannot produce a file; and because the completion handler
never runs, WebKit follows up with

    NSInternalInconsistencyException: Completion handler passed to
    -[DownloadDelegate download:decideDestination...] was not called

which is an uncaught Objective-C exception -- it takes the whole app down.
Reproduced on macOS 26.5 with pywebview 6.2.1 and pyobjc 12. Switching
ALLOW_DOWNLOADS on therefore turns a silent no-op into an unusable app, which is
strictly worse; see hosts/desktop/app.py::keep_pywebview_downloads_off.

So the page never downloads anything in the desktop app. It hands the file name
and the bytes to this bridge, and Python shows the save dialog and writes the
file. That is also what a sandboxed Mac App Store build needs: a location the
user picked, covered by com.apple.security.files.user-selected.read-write in
packaging/entitlements-mas.plist.
"""

from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Any, Callable, TypeVar

# pywebview exposes js_api methods to JavaScript under their Python names, so
# this one is called as `window.pywebview.api.save_file(...)`. Named here
# because src/lib/api.ts has to agree with it letter for letter.
SAVE_FILE = "save_file"

TEXT = "text"
BASE64 = "base64"

_Method = TypeVar("_Method", bound=Callable[..., Any])


def _internal(method: _Method) -> _Method:
    """Keep a method out of `window.pywebview.api`.

    pywebview publishes *every* public attribute of the js_api object to the
    page (webview/util.py::get_functions), recursing into anything that is not
    callable. Only save_file is meant for the page; the host-side plumbing is
    marked off here, and the attributes are underscore-prefixed so the walk does
    not descend into the pywebview window or a Path and re-export those too.
    """
    method._serializable = False  # type: ignore[attr-defined]
    return method


def default_directory() -> Path:
    """Where the save dialog starts: the user's Downloads folder if there is one
    -- the same place a browser download would have landed -- otherwise the home
    directory, which always exists."""
    downloads = Path.home() / "Downloads"
    return downloads if downloads.is_dir() else Path.home()


class FileBridge:
    """The `js_api` object of the desktop window.

    Imports pywebview only inside the one method that needs it and reaches the
    library only through the window it was attached to, so the class stays
    testable without the desktop extra installed or a window server running.
    """

    def __init__(self, directory: Path | None = None) -> None:
        self._window: Any = None
        self._directory = Path(directory) if directory is not None else default_directory()

    @_internal
    def attach(self, window: Any) -> None:
        """Called right after webview.create_window(): js_api has to be passed
        *to* create_window, so the bridge necessarily exists before the window
        it talks to does."""
        self._window = window

    @_internal
    def choose_path(self, name: str) -> str | None:
        """The native save panel, or None if the user cancelled.

        pywebview's create_file_dialog is the right seam: it hops to the UI
        thread itself (AppHelper.callAfter on macOS) and blocks only the js_api
        worker thread this runs on, so the window keeps drawing -- and it is the
        same call on all three backends.
        """
        import webview

        dialogs = getattr(webview, "FileDialog", None)
        chosen = self._window.create_file_dialog(
            dialogs.SAVE if dialogs is not None else 30,  # pre-6.x: webview.SAVE_DIALOG
            directory=str(self._directory),
            save_filename=name,
        )
        if not chosen:
            return None
        return chosen if isinstance(chosen, str) else chosen[0]

    def save_file(self, name: str, content: str, encoding: str = TEXT) -> dict[str, Any]:
        """Ask where to put `content` and write it there.

        Returns a verdict instead of raising: the caller is JavaScript, and a
        rejected pywebview promise carries a stringified Python traceback, which
        is not something to put in front of a novelist. `cancelled` is not an
        error -- the page stays quiet for it.
        """
        if self._window is None:
            return {"ok": False, "error": "The desktop window is not ready yet."}

        try:
            data = (
                base64.b64decode(content, validate=True)
                if encoding == BASE64
                else str(content).encode("utf-8")
            )
        except (binascii.Error, ValueError) as error:
            return {"ok": False, "error": f"The export could not be decoded: {error}"}

        try:
            target = self.choose_path(name)
        except Exception as error:  # noqa: BLE001 -- a failing dialog must not kill the window
            return {"ok": False, "error": f"The save dialog could not be opened: {error}"}
        if not target:
            return {"ok": False, "cancelled": True}

        path = Path(target)
        try:
            path.write_bytes(data)
        except OSError as error:
            return {"ok": False, "error": f"{path}: {error.strerror or error}"}

        # The next export starts where this one landed, like every other app.
        self._directory = path.parent
        return {"ok": True, "path": str(path)}
