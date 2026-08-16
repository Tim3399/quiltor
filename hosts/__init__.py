"""The ways Quiltor can be run.

Everything under here is an entry point: it owns a process, decides how the user
reaches the application, and then gets out of the way. Nothing in `backend/`
imports from here -- that direction is enforced by
tests/backend/test_hosts.py, because it is the whole point of the split.

  - **desktop** -- a native window (pywebview) around the local server, plus the
    tray icon and, in time, the native bridges a sandboxed build needs.
  - **cli** -- `quiltor run` / `quiltor config`, the pip/pipx install.
  - **mcp** -- a stdio MCP server exposing retrieval and proposal-only tools.

`server.py` at the repository root is deliberately *not* here, and there is no
`hosts/server/`. It is the HTTP application itself, not a way of running it:
the desktop host imports it and runs it in a thread, Docker runs it directly,
and both get the same thing. Filing it as a host alongside `desktop` would
suggest they are alternatives and that a desktop build could leave server code
out. It cannot -- the desktop app *is* the server, wrapped in a window.
"""
