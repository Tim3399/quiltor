"""Stamps page numbers onto a finished book PDF.

Only the WKWebView renderer needs this. Chromium draws the numbers itself from
`@bottom-center { content: counter(page) }` in src/styles.css, but WebKit's
print path does not implement CSS `@page` margin boxes at all -- see
backend/pdf/wkwebview.py for the measurements. Without this, a Mac App Store
build's book PDF would come out unnumbered.

The geometry is not invented: it was measured out of a Chromium-rendered book so
the two engines produce the same page, and the values below are derived from the
same CSS Chromium was reading.

  @page { size: 6in 9in; margin: .72in .68in .82in .78in; }
  @page:left  { margin-left: .68in; margin-right: .78in }
  @page:right { margin-left: .78in; margin-right: .68in }
  @page:first { @bottom-center { content: none } }

Two consequences worth stating, because both are easy to get wrong:

  - **The number is not centred on the page.** It is centred on the *text
    block*, and the left/right margins are mirrored for binding, so the centre
    alternates: 212.4 pt on a verso, 219.6 pt on a recto, against a page centre
    of 216. Chromium's own output sits at exactly those two positions.
  - **The title page carries no number**, and the counter still counts it, so
    the second page reads "2".
"""

from __future__ import annotations

POINTS_PER_INCH = 72
PAGE_WIDTH = 6 * POINTS_PER_INCH
NARROW_MARGIN = 0.68 * POINTS_PER_INCH  # outer edge
WIDE_MARGIN = 0.78 * POINTS_PER_INCH  # spine side

#: Lower edge of the text box, measured from the foot of the page. Chromium's
#: own numbers sit at y = 25.4 pt; NSAttributedString's box carries about half a
#: point of leading below the descender, so drawing at 24.9 lands on the same
#: line. Both figures are measurements of real output, not estimates.
BASELINE_FROM_FOOT = 24.9
FONT_SIZE = 7.0

#: --print-muted from src/design/colors.css.
INK = (0x5D / 255, 0x5A / 255, 0x54 / 255)


def centre_for(page_number: int) -> float:
    """Horizontal centre of the text block on this page.

    Recto (odd) pages carry the wide margin on the left, verso (even) pages on
    the right, so the block -- and the number under it -- shifts by 7.2 pt
    between them.
    """
    recto = page_number % 2 == 1
    left = WIDE_MARGIN if recto else NARROW_MARGIN
    right = NARROW_MARGIN if recto else WIDE_MARGIN
    return (left + (PAGE_WIDTH - right)) / 2


def numbers_for(page_count: int) -> list[str | None]:
    """The label for each page, or None where none is drawn.

    The title page is `@page:first` and gets nothing, but still counts -- which
    is why the second page reads "2" rather than "1".
    """
    return [None] + [str(index + 1) for index in range(1, page_count)]


def stamp(pdf: bytes) -> bytes:
    """Return `pdf` with page numbers drawn on. Never raises: an unnumbered book
    is worth shipping, a failed export is not."""
    try:
        return _stamp(pdf)
    except Exception as exc:  # noqa: BLE001 - the export matters more than the numbers
        print(f"  ! Seitenzahlen konnten nicht gesetzt werden: {exc}")
        return pdf


def _stamp(pdf: bytes) -> bytes:
    # AppKit rather than CoreText: pywebview's pyobjc set brings Cocoa and
    # Quartz but not pyobjc-framework-CoreText, and NSAttributedString draws
    # this perfectly well without adding a dependency for two glyphs.
    import AppKit
    import CoreFoundation
    import Foundation
    import Quartz

    source = Quartz.CGPDFDocumentCreateWithProvider(
        Quartz.CGDataProviderCreateWithCFData(CoreFoundation.CFDataCreate(None, pdf, len(pdf)))
    )
    if source is None:
        raise ValueError("Die gedruckte Datei ist kein lesbares PDF.")

    page_count = Quartz.CGPDFDocumentGetNumberOfPages(source)
    labels = numbers_for(page_count)
    # The media box has to be given twice, and both matter: once as the
    # context's default, and again per page. Left to default, a CGPDFContext
    # writes US Letter and the 6 x 9 inch book silently becomes 8.5 x 11.
    first_box = Quartz.CGPDFPageGetBoxRect(
        Quartz.CGPDFDocumentGetPage(source, 1), Quartz.kCGPDFMediaBox
    )
    output = CoreFoundation.CFDataCreateMutable(None, 0)
    context = Quartz.CGPDFContextCreate(
        Quartz.CGDataConsumerCreateWithCFData(output), first_box, None
    )

    attributes = {
        AppKit.NSFontAttributeName: AppKit.NSFont.systemFontOfSize_(FONT_SIZE),
        AppKit.NSForegroundColorAttributeName: AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(
            *INK, 1.0
        ),
    }

    for index in range(1, page_count + 1):
        page = Quartz.CGPDFDocumentGetPage(source, index)
        box = Quartz.CGPDFPageGetBoxRect(page, Quartz.kCGPDFMediaBox)
        # CGContextBeginPage takes the rect directly; the CGPDFContextBeginPage
        # dictionary form wants the box wrapped as CFData and silently keeps the
        # default page size when handed anything else.
        Quartz.CGContextBeginPage(context, box)
        Quartz.CGContextDrawPDFPage(context, page)

        label = labels[index - 1]
        if label is not None:
            drawing = AppKit.NSGraphicsContext.graphicsContextWithCGContext_flipped_(context, False)
            AppKit.NSGraphicsContext.saveGraphicsState()
            AppKit.NSGraphicsContext.setCurrentContext_(drawing)
            text = AppKit.NSAttributedString.alloc().initWithString_attributes_(label, attributes)
            # Unflipped, drawAtPoint_ takes the lower-left of the text box, which
            # is the same edge BASELINE_FROM_FOOT was measured against.
            text.drawAtPoint_(
                Foundation.NSMakePoint(
                    centre_for(index) - text.size().width / 2, box.origin.y + BASELINE_FROM_FOOT
                )
            )
            AppKit.NSGraphicsContext.restoreGraphicsState()

        Quartz.CGContextEndPage(context)

    Quartz.CGPDFContextClose(context)
    return bytes(output)
