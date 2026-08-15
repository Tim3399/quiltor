"""Direct distribution: the notarized Developer ID .dmg, the Inno Setup .exe,
Docker, and a plain source checkout. The default everywhere.

Nothing here is restricted -- the user chose to run this, and no store's rules
apply. This is also what every test and CI job sees unless it says otherwise.
"""
from __future__ import annotations

from backend.edition.contract import DIRECT

name = DIRECT
sandboxed = False
allows_code_download = True
allows_external_process = True
