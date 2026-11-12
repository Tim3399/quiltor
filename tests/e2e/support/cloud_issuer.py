"""The token issuer for the product suite's real sync endpoint (T-164).

Runs tests/python/fake_issuer.py as its own process: the authorization and token endpoints
a sign-in goes through, and the introspection endpoint the reference backup server checks
the result with. It needs PyJWT, which the application depends on anyway, so the browser
jobs have it after `pip install -e .`.

    PYTHONPATH=<repository root> python cloud_issuer.py <port>
"""

from __future__ import annotations

import sys
import threading

from tests.python.fake_issuer import FakeIssuer

if __name__ == "__main__":
    FakeIssuer().start(int(sys.argv[1]))
    threading.Event().wait()
