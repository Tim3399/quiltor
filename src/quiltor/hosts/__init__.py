"""The ways Quiltor can be run.

Everything under here is a composition root: it owns a process, decides how the
user reaches the application, wires concrete adapters, and then gets out of the
way. Domain, product modules, infrastructure, and delivery never import hosts;
``tests/python/test_hosts.py`` enforces that direction.

  - **desktop** -- a native window (pywebview) around the local server, plus the
    tray icon and, in time, the native bridges a sandboxed build needs.
  - **cli** -- `quiltor run` / `quiltor config`, the pip/pipx install.
  - **mcp** -- a stdio MCP server exposing retrieval and proposal-only tools.
  - **web** -- the shared HTTP process used by the source bootstrap, Docker,
    the CLI, and the desktop window.
"""
