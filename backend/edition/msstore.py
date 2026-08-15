"""Microsoft Store: MSIX-packaged.

Materially laxer than the Mac App Store, and the flags say so. A desktop-bridge
MSIX package is not sandboxed the way a sandboxed macOS app is -- it runs with
the user's normal token and can launch installed applications, so PDF export
via an installed browser keeps working here.

Downloading executable code is still refused. The Microsoft Store has no rule
as sharp as guideline 2.5.2, but a packaged app is expected to be self-contained
and its install footprint is managed by the OS: fetching a `llama-server` binary
into the user's profile at first run sits outside that model, and the bundled
runtime path exists anyway for the Mac App Store build. Keeping both stores on
one answer avoids a third code path for no gain.
"""
from __future__ import annotations

from backend.edition.contract import MSSTORE

name = MSSTORE
sandboxed = False
allows_code_download = False
allows_external_process = True
