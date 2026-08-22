"""Native capabilities the page cannot reach on its own, exposed to the desktop
window as `window.pywebview.api`.

Everything here is OS-agnostic: the one platform difference that matters (which
native panel gets shown) is pywebview's job, not ours.
"""

from __future__ import annotations

from .api import BRIDGE_VERSION, FILE_SAVE, INVOKE, NativeBridge

__all__ = ["BRIDGE_VERSION", "FILE_SAVE", "INVOKE", "NativeBridge"]
