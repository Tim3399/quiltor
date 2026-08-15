"""Renders through WKWebView's own print operation -- the only route a
sandboxed Mac App Store build has.

**Not implemented yet.** The selection logic that reaches it is, and a Mac App
Store build lands here rather than silently falling back to a renderer the
sandbox would refuse. Everything needed to finish it is written down below;
what is missing is a Mac to verify it on, since none of this can be exercised
without AppKit and a real window server.

Design
------
`render()` is called from an HTTP handler thread, but AppKit insists on the main
thread. So: hand a block to `NSOperationQueue.mainQueue()`, block the caller on
a `queue.Queue` with the caller's timeout, and re-raise on that thread.

On the main thread, build an offscreen `WKWebView` sized 432 x 648 pt (6 x 9
inch), load `url`, and wait for the app to finish hydrating -- then
`printOperationWithPrintInfo:` (macOS 11+) with `showsPrintPanel_(False)`,
`showsProgressPanel_(False)`, `NSPrintSaveJob`, and `NSPrintJobSavingURL`
pointing at a temporary file.

Do *not* reach for `createPDFWithConfiguration:completionHandler:` instead. It
puts the entire document on a single enormous page, which is useless for a book.

Two things to watch, both documented by other people hitting them:

  - `NSPrintSaveJob` has a long history of writing blank pages with a correct
    page count, and `runOperation` has been reported not to run at all where
    `runOperationModalForWindow:` does. Expect to try both.
  - Waiting for `didFinishNavigation:` alone is not enough -- that fires before
    React has rendered. Poll from JavaScript for `.print-document` having
    content. Deliberately *not* the German aria-label the Chromium path waits
    on (`system_browser.py`): that only works because a fresh browser profile
    defaults the UI to German, and it would become a 90 s timeout the day that
    default changes.

The page-layout caveat
----------------------
`src/styles.css` builds the book with CSS Paged Media: `@page { size: 6in 9in }`,
mirrored `@page:left` / `@page:right` margins, `@bottom-center { content:
counter(page) }` for page numbers, `@page:first` to suppress it on the title
page, and `break-before: right` so chapters open on a recto.

WebKit only shipped `@page` margin boxes in **Safari 18.2** (December 2024), and
WKWebView renders with the system WebKit. So page numbers work on macOS 15.2 and
newer and are simply absent below it. That is a product decision, not a coding
one: either raise `LSMinimumSystemVersion` to 15.2 and lose older Macs, or ship
a book PDF whose pages are unnumbered for them. It needs deciding before this
renderer is written, because the fallback (drawing the numbers ourselves into
the margin box) is a different and much larger piece of work.

Verify the rest of the Paged Media usage on device at the same time; mirrored
margins and forced recto breaks have historically been weaker in WebKit than in
Chromium, and the Chromium path is what every existing book PDF was made with.
"""
from __future__ import annotations

UNAVAILABLE = (
    "Der PDF-Export über WKWebView ist in dieser Ausgabe noch nicht verfügbar. "
    "Bitte exportiere das Manuskript vorerst als Markdown."
)


def render(url: str, timeout: int = 90) -> bytes:
    raise NotImplementedError(UNAVAILABLE)
