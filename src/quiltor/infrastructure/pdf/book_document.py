"""DOM contract shared by every book PDF renderer."""

from __future__ import annotations

import math

MIN_PAPER_MM = 50.0
MAX_PAPER_MM = 1000.0

# Both snippets are expressions because WKWebView and pywebview evaluate an
# expression rather than a function body.
RENDER_STATE_JS = """
(function () {
  var root = document.querySelector('.print-document');
  if (!root) return { state: 'waiting' };
  if (root.getAttribute('data-book-error') === 'true') {
    return { state: 'error' };
  }
  if (root.getAttribute('data-book-ready') === 'true' &&
      root.querySelector('.pagedjs_page')) {
    return { state: 'ready' };
  }
  return { state: 'waiting' };
})();
"""

PAPER_GEOMETRY_JS = """
(function () {
  var root = document.querySelector('.print-document[data-book-ready="true"]');
  if (!root) return null;
  return {
    widthMm: Number(root.getAttribute('data-book-width-mm')),
    heightMm: Number(root.getAttribute('data-book-height-mm'))
  };
})();
"""


def render_state(value) -> str:
    """Normalize the JavaScript result returned by the different web views."""
    if hasattr(value, "get"):
        state = value.get("state")
        if state in {"waiting", "ready", "error"}:
            return state
    return "waiting"


def validate_paper_mm(value) -> tuple[float, float]:
    """Return trustworthy DOM paper dimensions or fail before native printing."""
    if not hasattr(value, "get"):
        raise RuntimeError("The book view did not provide paper dimensions.")
    width, height = value.get("widthMm"), value.get("heightMm")
    if isinstance(width, bool) or isinstance(height, bool):
        raise RuntimeError("The book view provided invalid paper dimensions.")
    try:
        width, height = float(width), float(height)
    except (TypeError, ValueError, OverflowError):
        raise RuntimeError("The book view provided invalid paper dimensions.") from None
    if not (
        math.isfinite(width)
        and math.isfinite(height)
        and MIN_PAPER_MM <= width <= MAX_PAPER_MM
        and MIN_PAPER_MM <= height <= MAX_PAPER_MM
    ):
        raise RuntimeError("The book view provided invalid paper dimensions.")
    return width, height
