# Quiltor MCP server

`quiltor_server.py` exposes local world knowledge and safe proposal tools over MCP stdio. It never writes to SQLite, Git, manuscript files, or backups. Mutation-shaped tools only return a proposal with `requiresConfirmation: true` and `applied: false`.

The repository-level `.mcp.json` starts the server for clients that support project MCP configuration. Other clients can launch it with:

```sh
python3 hosts/mcp/quiltor_server.py
```

The server uses `QUILTOR_DATA_DIR` when the world data is stored outside the default `data/` directory.
