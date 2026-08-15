"""Mac App Store: sandboxed, and bound by App Review.

Two separate rulebooks land on the same two flags:

  - **Guideline 2.5.2** forbids downloading executable code. That rules out
    fetching `llama-server` from GitHub releases (it ships inside the bundle
    instead, signed with our Team ID -- see backend/llm/runtimes/), the MLX
    runtime's venv + pip install, and LanguageTool's JAR. Model weights are
    *data*, so they stay a download; they have to, since the Store caps an app
    at 4 GB and the weights alone are ~2.5 GB.
  - **The App Sandbox** forbids executing anything outside our own bundle. That
    rules out the system JVM behind LanguageTool and the installed Chrome/Edge
    behind PDF export, independently of 2.5.2.

See packaging/entitlements-mas.plist for the matching sandbox declaration.
"""
from __future__ import annotations

from backend.edition.contract import MAS

name = MAS
sandboxed = True
allows_code_download = False
allows_external_process = False
