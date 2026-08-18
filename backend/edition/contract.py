"""What distinguishes one distribution of Quiltor from another.

The editions differ in what the distribution channel *permits*, not in what
Quiltor is for. So this surface is deliberately a set of policy answers rather
than a list of implementation names: a capability asks "may I download and run
code?", not "am I in the Store?". That keeps the reasoning next to the rule it
comes from, and means adding a fourth channel is a matter of answering the same
questions differently.

Keep it that way. `if edition.name == "mas"` scattered through a capability is
the thing this package exists to prevent -- ask a policy question instead, and
add one here if none of them fits.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

DIRECT = "direct"
MAS = "mas"
MSSTORE = "msstore"
EDITIONS = (DIRECT, MAS, MSSTORE)


@runtime_checkable
class EditionPolicy(Protocol):
    """The per-distribution surface. backend/edition/__init__.py picks one at
    import time and re-exports it."""

    #: One of EDITIONS.
    name: str

    #: Running inside the OS's app container, with the filesystem and process
    #: restrictions that brings.
    sandboxed: bool

    #: May we download something and then execute it? App Store guideline 2.5.2
    #: forbids it; downloading *data* (model weights, dictionaries) stays fine
    #: either way, and is not what this asks about.
    allows_code_download: bool

    #: May we launch an executable that is not inside our own signed bundle --
    #: the system JVM, an installed copy of Chrome? The sandbox refuses.
    allows_external_process: bool
