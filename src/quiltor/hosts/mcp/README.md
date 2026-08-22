# Quiltor MCP server

`quiltor_server.py` exposes local world knowledge and safe proposal tools over MCP stdio. It never writes to SQLite, the snapshot history, manuscript files, or backups. Mutation-shaped tools only return a proposal with `requiresConfirmation: true` and `applied: false`.

Installing the Python package provides the platform-neutral `quiltor-mcp`
console command. The repository-level `.mcp.json` uses that command so the
same configuration works on Windows, macOS, and Linux. Install a source checkout
before using its project configuration:

```sh
python -m pip install -e .
quiltor-mcp
```

The server uses `QUILTOR_DATA_DIR` when the world data is stored outside the default `data/` directory.
