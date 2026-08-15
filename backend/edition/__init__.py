"""Which distribution of Quiltor this process is running as.

Three exist, and they differ in what their distribution channel lets them do
rather than in what they are for:

  - **direct** -- the Developer ID `.dmg`, the Inno Setup `.exe`, Docker, and a
    source checkout. Unrestricted. The default everywhere.
  - **mas** -- the sandboxed Mac App Store build.
  - **msstore** -- the MSIX-packaged Microsoft Store build.

Detection is at runtime, not compile time, and deliberately so: one build then
behaves correctly in either context, and -- the part that matters day to day --
the Store code paths stay testable on an ordinary checkout via QUILTOR_EDITION.
A compile-time switch would make the restricted paths unreachable without
producing a Store build first, which is how they would quietly rot.

    QUILTOR_EDITION=mas python3 -m backend.llm.installer   # refuses to download

Callers ask the policy questions in contract.py (`allows_code_download()`,
`allows_external_process()`), not `edition() == "mas"`. `is_store_build()`
remains for the handful of places that genuinely mean "any store", such as
refusing MLX.

The environment is consulted on every call, so setting QUILTOR_EDITION in a
test's environment is enough; tests may also patch an individual question where
that reads better. See tests/backend/test_edition.py.
"""
from __future__ import annotations

import os

from backend import system
from backend.edition import direct, mas, msstore
from backend.edition.contract import DIRECT, EDITIONS, MAS, MSSTORE, EditionPolicy

_BY_NAME: dict[str, EditionPolicy] = {DIRECT: direct, MAS: mas, MSSTORE: msstore}


def _detect() -> EditionPolicy:
    override = os.environ.get("QUILTOR_EDITION", "").strip().casefold()
    if override:
        if override not in EDITIONS:
            raise SystemExit(f"Unknown QUILTOR_EDITION={override!r}. Expected one of: {', '.join(EDITIONS)}")
        return _BY_NAME[override]
    # The OS tells us whether we are in its app container (sandbox on macOS,
    # MSIX on Windows); which store that implies follows from the platform.
    if system.in_os_app_package():
        return mas if system.os_name() == "macos" else msstore
    return direct


# Everything below is a function, and detection runs per call rather than once
# at import. Both on purpose: a module-level constant would freeze whatever the
# environment said at import time, which a caller doing `from backend.edition
# import allows_code_download` could never see changed -- and neither could a
# test. Detection itself is two environment lookups on macOS and one cached
# Windows API call, so there is nothing to save by memoising it here.

def current() -> EditionPolicy:
    """The active policy object, for code that wants to pass the whole thing
    around. Everything else should call one of the questions below."""
    return _detect()


def edition() -> str:
    return _detect().name


def is_sandboxed() -> bool:
    return _detect().sandboxed


def allows_code_download() -> bool:
    """Whether we may download something and then execute it (guideline 2.5.2).
    Downloading data -- model weights, dictionaries -- is a different question
    and always allowed."""
    return _detect().allows_code_download


def allows_external_process() -> bool:
    """Whether we may launch an executable from outside our own signed bundle:
    the system JVM, an installed browser."""
    return _detect().allows_external_process


def is_store_build() -> bool:
    """True for any store distribution. Prefer a specific policy question where
    one fits; this is for cases that really do mean "a store", such as refusing
    a runtime no store would accept."""
    return _detect().name != DIRECT


__all__ = [
    "DIRECT", "EDITIONS", "MAS", "MSSTORE", "EditionPolicy",
    "allows_code_download", "allows_external_process", "current", "edition",
    "is_sandboxed", "is_store_build",
]
