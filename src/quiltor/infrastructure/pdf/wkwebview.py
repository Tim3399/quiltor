"""Renders through WKWebView's own print operation -- the only route a
sandboxed Mac App Store build has.

Everything here was worked out against a real WKWebView on macOS 26.5.2 rather
than from documentation, because almost every step has a trap:

  - **Threading.** `render()` is called from an HTTP handler thread, but AppKit
    insists on the main one. The work is handed to `NSOperationQueue.mainQueue()`
    and the caller blocks on a queue. Nothing here pumps a run loop: in the
    desktop app the main thread is already running pywebview's, and spinning our
    own would freeze the window.
  - **`runOperation()` deadlocks.** It wants to own the run loop and never
    returns in an embedded setting. `runOperationModalForWindow:` returns
    immediately and calls back, which is what this uses.
  - **The print delegate is not retained** by the operation. An inline temporary
    is collected before the callback fires, and AppKit then sends the selector
    to whatever now occupies the address -- "unrecognized selector sent to
    instance" from a class you have never heard of. Hence `_alive`.
  - **The web view needs a window** for the print operation to lay out through.
    Borderless and never ordered front, so nothing appears on screen.
  - **Poll gently.** Waiting for the app to finish rendering by calling
    `evaluateJavaScript` in a tight loop starves the web content process, and
    the page then never gets far enough to render at all. Four times a second is
    plenty; the app is ready in about two seconds.
  - **`evaluateJavaScript` takes an expression**, so the readiness check is an
    IIFE. (`callAsyncJavaScript` is the opposite -- it takes a function body.)
  - Methods on an `NSObject` subclass become Objective-C selectors unless
    marked `@objc.python_method`.
  - **An Objective-C class can only be defined once per process.** Running the
    `class RenderDelegate(AppKit.NSObject)` statement a second time raises
    `error('RenderDelegate is overriding existing Objective-C class')`, so the
    two factories below are cached: without that, the first book PDF of a
    session works and every one after it fails until the app is restarted.

Readiness and paper geometry come from the explicit paginated book DOM. Page
numbers are part of those physical pages, so the native output needs no PDF
post-processing.
"""

from __future__ import annotations

import queue
import tempfile
from functools import lru_cache
from pathlib import Path

from quiltor.infrastructure.pdf.book_document import (
    PAPER_GEOMETRY_JS,
    RENDER_STATE_JS,
    render_state,
    validate_paper_mm,
)

POINTS_PER_MM = 72 / 25.4
POLL_INTERVAL_SECONDS = 0.25

UNAVAILABLE = (
    "PDF export requires this build's macOS system components "
    "(pyobjc). Export the manuscript as Markdown until they are available."
)

#: Objects AppKit will call back into but does not retain. Cleared per render.
_alive: list[object] = []


def render(url: str, timeout: int = 90) -> bytes:
    """Render `url` to PDF bytes. Safe to call from any thread."""
    try:
        import AppKit
        import Foundation
    except ImportError as exc:  # pragma: no cover - depends on the desktop extra
        raise RuntimeError(UNAVAILABLE) from exc

    results: queue.Queue = queue.Queue(maxsize=1)
    Foundation.NSOperationQueue.mainQueue().addOperationWithBlock_(lambda: _start(url, results))

    try:
        kind, payload = results.get(timeout=timeout)
    except queue.Empty:
        raise RuntimeError(f"PDF export did not respond within {timeout}s.") from None
    finally:
        _alive.clear()

    if kind == "error":
        raise RuntimeError(payload)
    data = Path(payload).read_bytes()
    Path(payload).unlink(missing_ok=True)
    if not data:
        raise RuntimeError("PDF export produced an empty file.")
    return data


def _start(url: str, results: queue.Queue) -> None:
    """Main thread: build an offscreen web view and start loading."""
    import AppKit
    import Foundation
    import WebKit

    try:
        frame = Foundation.NSMakeRect(0, 0, 800, 1000)
        view = WebKit.WKWebView.alloc().initWithFrame_configuration_(
            frame, WebKit.WKWebViewConfiguration.alloc().init()
        )

        window = AppKit.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            frame, AppKit.NSWindowStyleMaskBorderless, AppKit.NSBackingStoreBuffered, False
        )
        window.setContentView_(view)

        delegate = _navigation_delegate().alloc().initWithWindow_results_(window, results)
        view.setNavigationDelegate_(delegate)
        _alive.extend((view, window, delegate))

        view.loadRequest_(
            Foundation.NSURLRequest.requestWithURL_(Foundation.NSURL.URLWithString_(url))
        )
    except Exception as exc:  # noqa: BLE001 - the caller is a queue, not a stack
        results.put(("error", repr(exc)))


@lru_cache(maxsize=1)
def _navigation_delegate():
    """Built lazily so importing this module never requires pyobjc -- and exactly
    once, because the second `class RenderDelegate(...)` in a process is an
    error, not a redefinition."""
    import AppKit
    import Foundation
    import objc

    class RenderDelegate(AppKit.NSObject):
        def initWithWindow_results_(self, window, results):
            self = objc.super(RenderDelegate, self).init()
            self.window = window
            self.results = results
            self.waited = 0.0
            return self

        def webView_didFinishNavigation_(self, view, navigation):
            # Fires before React has rendered, so ask the DOM rather than trust it.
            self.check(view)

        def webView_didFailNavigation_withError_(self, view, navigation, error):
            self.results.put(("error", f"Could not load the page: {error}"))

        def webView_didFailProvisionalNavigation_withError_(self, view, navigation, error):
            self.results.put(("error", f"Could not load the page: {error}"))

        @objc.python_method
        def check(self, view):
            def handler(result, error):
                if error is not None:
                    self.results.put(("error", f"Readiness check failed: {error}"))
                elif render_state(result) == "error":
                    self.results.put(("error", "The book view reported a pagination error."))
                elif render_state(result) == "ready":
                    self.read_geometry(view)
                else:
                    self.waited += POLL_INTERVAL_SECONDS
                    if self.waited > 60:
                        self.results.put(("error", "The book view did not finish rendering."))
                        return
                    Foundation.NSTimer.scheduledTimerWithTimeInterval_repeats_block_(
                        POLL_INTERVAL_SECONDS, False, lambda timer: self.check(view)
                    )

            view.evaluateJavaScript_completionHandler_(RENDER_STATE_JS, handler)

        @objc.python_method
        def read_geometry(self, view):
            def handler(value, error):
                if error is not None:
                    self.results.put(("error", f"Paper geometry query failed: {error}"))
                    return
                try:
                    self.print_(view, validate_paper_mm(value))
                except Exception as exc:  # noqa: BLE001
                    self.results.put(("error", str(exc)))

            view.evaluateJavaScript_completionHandler_(PAPER_GEOMETRY_JS, handler)

        @objc.python_method
        def print_(self, view, paper_mm):
            try:
                target = Path(tempfile.mkstemp(suffix=".pdf")[1])
                info = AppKit.NSPrintInfo.sharedPrintInfo().copy()
                info.setPaperSize_(
                    AppKit.NSMakeSize(paper_mm[0] * POINTS_PER_MM, paper_mm[1] * POINTS_PER_MM)
                )
                # Zero here; the page's own @page rule owns the margins.
                for setter in (
                    "setTopMargin_",
                    "setBottomMargin_",
                    "setLeftMargin_",
                    "setRightMargin_",
                ):
                    getattr(info, setter)(0.0)
                info.setHorizontalPagination_(AppKit.NSPrintingPaginationModeFit)
                info.setVerticalPagination_(AppKit.NSPrintingPaginationModeAutomatic)
                info.setJobDisposition_(AppKit.NSPrintSaveJob)
                info.dictionary().setObject_forKey_(
                    Foundation.NSURL.fileURLWithPath_(str(target)), AppKit.NSPrintJobSavingURL
                )

                operation = view.printOperationWithPrintInfo_(info)
                operation.setShowsPrintPanel_(False)
                operation.setShowsProgressPanel_(False)

                sink = _print_sink().alloc().initWithTarget_results_(target, self.results)
                _alive.append(sink)  # the operation does not retain its delegate
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo_(
                    self.window, sink, b"printOperationDidRun:success:contextInfo:", None
                )
            except Exception as exc:  # noqa: BLE001
                self.results.put(("error", repr(exc)))

    return RenderDelegate


@lru_cache(maxsize=1)
def _print_sink():
    """Cached for the same reason as _navigation_delegate(): one PrintSink class
    per process, or the second export of a session raises."""
    import AppKit
    import objc

    class PrintSink(AppKit.NSObject):
        def initWithTarget_results_(self, target, results):
            self = objc.super(PrintSink, self).init()
            self.target = target
            self.results = results
            return self

        def printOperationDidRun_success_contextInfo_(self, operation, success, context):
            if success and self.target.exists() and self.target.stat().st_size:
                self.results.put(("ok", str(self.target)))
            else:
                self.results.put(("error", "The print operation did not produce a PDF."))

        printOperationDidRun_success_contextInfo_ = objc.selector(
            printOperationDidRun_success_contextInfo_, signature=b"v@:@Z^v"
        )

    return PrintSink
