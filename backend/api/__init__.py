"""The HTTP layer: what Quiltor's routes do, separated from how requests arrive.

`server.py` keeps the plumbing -- the socket, the handler class, header parsing,
cookies, the local-mode request guard -- and this package holds the routes
themselves, grouped by what they are about.

Nothing here imports `server`. Route functions receive the server module as
`app` instead, which is not ceremony: `desktop.py` swaps `server.RENDER_PDF` at
startup and the test suite reassigns `server.AUTH_ENABLED`,
`server.WORLD_BACKUPS` and friends. A `from server import ...` would bind those
once at import time and quietly ignore every later change, so the indirection is
what keeps both working. tests/backend/test_hosts.py enforces the rule.
"""
