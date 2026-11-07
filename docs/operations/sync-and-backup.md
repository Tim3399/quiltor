# Sync, backup and local data

Where your projects live, how access and sign-in work and how a backup server is connected through Keycloak.

## Local-first means your project belongs to you

A local Quiltor setup needs no cloud account.

**Free local writing under the [published licence](../../README.en.md#status-and-license). No writing subscription.**

Every world is stored in its own SQLite database on your machine. Manuscript and profile data are additionally mirrored into readable Markdown files. Automatic local backups and project history are part of the storage model.

Remote backup is optional and can be run against your own backup endpoint.

Free manual `.quiltor` project transfer includes the current project, set-aside chapters,
chapter trash and required images. Import creates a new world. Earlier backups and saved
history are explicitly excluded; use the backup and history tools to restore those.
Ordinary book export contains only chapters included in the book.

A successful local save, a recoverable snapshot, and a transfer to a backup server are
separate operations. Under **More → Versions & backups**, the **Sync with other
devices** tab's **Sync now** button synchronizes a project with a compatible endpoint on demand. Concurrent changes and deletion versus offline edits
retain both versions and require an explicit choice. Background transfers and automatic text
merging are not implemented. An unreachable endpoint does not lock the local editor.
See the [cloud service guide](../../services/backup-server/README.md) for configuration and
operating limits.

A paid managed cloud offer with a price, quota, and retention period has not been defined.
There is consequently no promise here about cancellation terms, end-to-end encryption,
or hosting region. A self-hosted endpoint's operator defines its terms. Hosted web operation
stores project data on that server, which is a different storage location from the local
workshop on your computer.

The assistant remains local as well:

- model runtime on loopback
- no mandatory cloud AI provider
- external LanguageTool-compatible services only after explicit opt-in
- no manuscript-writing tools in the assistant or MCP

## Local access and authentication

There is no "authentication off" mode. Every request has an identity; locally, that identity is simply the person at the machine.

Without `QUILTOR_OIDC_ISSUER`, Quiltor uses the **local identity**:

- one user
- no login page
- no account management

Access is recognised in this order:

1. `Authorization: Bearer <token>` — scripts and MCP
2. `?token=<token>` — one-time browser entry; the redirect strips the parameter
3. loopback connection — ordinary case for desktop, CLI, and `python3 apps/web/server.py`

The automatically generated token:

- is created fresh on every process start
- lives only in memory
- is never written to disk
- is only printed when explicitly requested with `--print-token`

| Variable               | Purpose                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `QUILTOR_MASTER_TOKEN` | Pins the token. Intended for tests or instances not bound to loopback. Do not store it in `~/.quiltor/config.env`. |
| `QUILTOR_HOST`         | Bind address; defaults to `127.0.0.1`.                                                                             |

An instance bound to `0.0.0.0` without OIDC cannot rely on the local loopback identity and therefore requires a token. For a persistent web deployment, OIDC/Keycloak is the intended path.

### Troubleshooting

| Symptom                                     | Fix                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `python3: command not found`                | On Windows, use `py -3.12`; inside an activated virtual environment, use `python`.                   |
| Assistant reports "Local model unavailable" | Run `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer`, then restart the server. |
| Download is interrupted                     | Run the installer again; complete files are reused.                                                  |
| Firewall/antivirus flags `llama-server.exe` | The binary comes from the official llama.cpp release and listens locally.                            |
| Port 8000 is taken                          | `python3 apps/web/server.py 8080`                                                                    |
| Different runtime / model                   | Use `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL`, or `QUILTOR_AI_URL`.                                    |

## Backup and Keycloak

Keycloak has two separate roles in Quiltor:

|           | Signing in to Quiltor                | Backup endpoint                             |
| --------- | ------------------------------------ | ------------------------------------------- |
| Purpose   | Multi-user web instance              | Remote-backup access                        |
| Required  | No                                   | Yes for the supplied backup endpoint        |
| Client    | confidential                         | backup server confidential + Quiltor public |
| Redirect  | `<QUILTOR_PUBLIC_URL>/auth/callback` | `http://127.0.0.1/*`                        |
| Variables | `QUILTOR_OIDC_*`                     | `QUILTOR_BACKUP_OIDC_*`                     |

Both may use the same realm, but they are technically separate.

### Backup server: confidential client

Example name:

```text
quiltor-backup-server
```

Settings:

- Client authentication: on
- Standard Flow: off
- Direct Access Grants: off

The backup server validates incoming access tokens through Keycloak Token Introspection.

### Quiltor: public backup client

Example:

```text
quiltor-desktop
```

Settings:

- Client authentication: off
- Standard Flow: on
- Direct Access Grants: off
- PKCE: `S256`
- Redirect URI: `http://127.0.0.1/*`

The changing loopback port is intentional. Native applications are expected to support dynamic loopback ports under RFC 8252, so the Keycloak client must not be restricted to one fixed port.

### `quiltor.backup` scope

The supplied backup endpoint requires this scope by default:

```text
quiltor.backup
```

This prevents an arbitrary valid token from the same realm from being enough. The token must explicitly be intended for backup access.

A realm role may additionally be used to make the scope available only to selected accounts.

### Backup-server variables

| Variable                            | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `QUILTOR_BACKUP_OIDC_ISSUER`        | Realm issuer                                 |
| `QUILTOR_BACKUP_OIDC_CLIENT_ID`     | Backup-server client ID                      |
| `QUILTOR_BACKUP_OIDC_CLIENT_SECRET` | Client secret used for introspection         |
| `QUILTOR_BACKUP_PUBLIC_URL`         | Public backup endpoint URL                   |
| `QUILTOR_BACKUP_OIDC_SCOPE`         | Required scope; defaults to `quiltor.backup` |

If required authentication values are missing, the backup endpoint deliberately refuses to start.

Example:

```bash
# Backup server
QUILTOR_BACKUP_OIDC_ISSUER=https://kc.example.com/realms/quiltor
QUILTOR_BACKUP_OIDC_CLIENT_ID=quiltor-backup-server
QUILTOR_BACKUP_OIDC_CLIENT_SECRET=...
QUILTOR_BACKUP_PUBLIC_URL=https://backup.quiltor.app
QUILTOR_BACKUP_OIDC_SCOPE=quiltor.backup

# Quiltor
QUILTOR_BACKUP_URL=https://backup.quiltor.app
QUILTOR_BACKUP_CLIENT_ID=quiltor-desktop
```

The client does not need a duplicate Keycloak issuer setting for the backup service. The endpoint publishes its authorization metadata through:

```text
GET /.well-known/oauth-protected-resource
```

Quiltor reads that metadata before sign-in.

### Backup troubleshooting

| Symptom                                                     | Likely cause                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Keycloak error page and Quiltor never receives the callback | Loopback redirect is missing or restricted to a fixed port        |
| Endpoint returns 401                                        | Token is missing or expired                                       |
| Endpoint returns 403                                        | Token is valid but lacks the required scope                       |
| Introspection fails                                         | Token and `QUILTOR_BACKUP_OIDC_ISSUER` belong to different realms |

## Local data, history, and restore

- Every world has its own SQLite file under `data/worlds/`.
- SQLite is the authoritative data source.
- Manuscript/profile mirrors live per world under `data/manuscripts/<world-id>/` and `data/profiles/<world-id>/`.
- Automatic SQLite backups can be restored locally.
- Revision checks prevent stale browser tabs from overwriting newer changes.
- Every world keeps local version history.
- Snapshots are content-addressed, so unchanged chapters do not need to be stored repeatedly.
- Remote backup is optional.
- World content, models, backups, and history are excluded from public version control.

### Notes for upgrading older versions

Current builds always use an identity. Locally, the local identity takes over; non-loopback instances without OIDC require a token.

Markdown mirrors are now organized per world. Old flat mirror files are not the authoritative source; SQLite remains authoritative.

The server no longer has one process-wide "open world" state, so restoring a world does not require closing a global open-world session first.
