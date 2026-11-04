# Server log

The Quiltor server writes one JSON object per line. Each line has `timestamp`, `level` (the severity of that line, lower case), `event`, and the fields of that event. `src/quiltor/infrastructure/observability/schema.py` is the source of truth for events and fields; this page only describes how to find and read the log.

## Where the log goes

| How you run Quiltor               | Where to read it                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Docker / `docker compose`         | `docker compose logs quiltor` (stderr). Docker rotates it: 10 MB per file, 5 files.                  |
| Command line (`quiltor run`)      | The terminal (stderr).                                                                               |
| Desktop app with a console        | The console (stderr).                                                                                |
| Desktop app in window mode        | `quiltor-server.log` in the app's `logs` folder (a window has no console, so a file is the default). |
| Anywhere, with `QUILTOR_LOG_FILE` | stderr **and** that file.                                                                            |

Plain status lines the server prints (the start banner, "Manuscript saved") go to stdout and are not part of the structured log.

## Level and file

| Variable            | Values                                         | Default                               |
| ------------------- | ---------------------------------------------- | ------------------------------------- |
| `QUILTOR_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR` (any case) | `INFO`                                |
| `QUILTOR_LOG_FILE`  | a file path; empty means no file               | none (desktop window mode: see above) |

- An invalid level stops the start with exit code 2 and a message on stderr. It is not silently replaced by `INFO`, so a typo is noticed.
- The file is rotated at 10 MiB and five backups are kept (`quiltor-server.log.1` ... `.5`). Its folder is created if missing. If it cannot be written, the start stops with exit code 2.
- `DEBUG` adds the access lines for the web client's own files (`route` is `client_asset`). At `INFO` only API requests are logged, and the status polls of the assistant (`/api/assistant/progress`, `/api/assistant/status`) are `DEBUG` as well. Errors are always logged.
- With Docker Compose set the variables in `.env` (see `.env.example`). A log file inside the container must live on a mounted volume, for example `/data/quiltor-server.log`; otherwise it is lost with the container.
- With the CLI, `quiltor config set QUILTOR_LOG_LEVEL DEBUG` persists the setting.

The server writes a `logging.configured` line at the start with the active `log_level` (and `file` when one is set).

## Finding a request from an error ID

Every response carries an `X-Request-Id` header. An error response also carries the same value as `error.requestId` in its JSON body. A request ID is 16 characters from `a-z` and `2-7`. A client may send its own `X-Request-Id`; it is kept only if it has that plausible shape, otherwise the server makes a new one.

When a save fails, the editor shows this ID next to the save status as “Fehler-ID”; the author can select it with one click and pass it on.

Given an ID, for example `7jweja5ku7bibso4`:

```bash
docker compose logs quiltor | grep 7jweja5ku7bibso4
```

or in a log file:

```bash
grep 7jweja5ku7bibso4 quiltor-server.log
```

You get the `http.access` line (method, route, status, duration, sizes) and, for a failure, the `http.error` line with the error `code`, plus the line that explains it (see below). To list every failure:

```bash
grep '"event": "http.error"' quiltor-server.log
```

## Events, roughly

| Event                      | When                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `http.access`              | once per request                                                   |
| `http.error`               | every API answer with status 400 or above, with its error `code`   |
| `http.unhandled`           | an exception no route handled, with `error_type` and a `traceback` |
| `document.save_rejected`   | a save refused for its content or revision                         |
| `document.save_conflict`   | a save refused because the document changed in the meantime        |
| `world.resolve_failed`     | the requested world is invalid, forbidden or missing (`reason`)    |
| `storage.failed`           | the database or the disk failed, with the raw error code           |
| `logging.configured`       | once at start                                                      |
| `install.forbidden_hosted` | an install request refused because the server is hosted (OIDC)     |
| `sync.forbidden_hosted`    | a device-sync request refused because the server is hosted (OIDC)  |
| `backup.*_failed`          | a backup, restore or backup sign-in step failed, with `error_type` |

The backup failures are `backup.preview_failed`, `backup.remote_worlds_failed`, `backup.snapshot_failed`, `backup.remote_restore_failed`, `backup.local_restore_request_invalid`, `backup.local_restore_failed`, `backup.login_start_failed`, `backup.login_callback_rejected` and `backup.login_callback_failed`; each carries the exception's type, never its text. `backup.remote_request_failed` is written when a call to the backup endpoint fails and carries the call's `operation` (`push`, `worlds`, `snapshots`, `fetch_blob`, `account`, `sync_head`) and `error_type`, never the endpoint or the exception's text. Further events from other parts of the server (identity, assistant) keep their own fields.

## What is never in the log

The log must be safe to attach to a bug report. These never appear in it:

- manuscript, world and storyboard content: titles, names, notes
- request and response bodies, in whole or in part
- query strings (they can carry `?token=`, `?renderToken=` or `?world=`)
- cookies and `Set-Cookie`, `Authorization` headers, bearer, master and render tokens, OIDC `code`, `state` and tokens
- API keys and backup tokens
- the session's `email` and `name` (only its opaque `sub` is logged)
- file system paths that contain world names (the one exception is the log file's own path in `logging.configured`)

This is enforced in the logger: only fields registered for an event are written, every value passes a pattern check, a field that fails it is written as `<invalid>`, and the `route` comes from the server's route table, never from the request URL. The text of an exception is written only for the server's own error types (their `code`) and in the `traceback` of `http.unhandled`, whose text has no exception message from foreign types.
