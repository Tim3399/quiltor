"""Snapshot history, the local SQLite backups, the remote endpoint, and the
login that opens it.

The login half at the bottom of this file is four routes rather than one,
because signing in to a foreign service is three separate moments -- asking
where we stand, starting a browser flow, catching what the browser brings back
-- plus putting the credential down again.
"""

from __future__ import annotations

import html
from datetime import datetime

from backend import auth, backup_login
from backend.api.routes import Request, get, save
from backend.core import storage
from backend.core.backup import remote as backup_remote
from backend.core.mirror import mirror_profiles, mirror_text, safe_name


# Every route registered `world=True` has its world resolved by the dispatch, so
# `request.world` is never None below and its snapshot context is the only
# context there is -- no process-wide "currently open world" exists any more.


@get("/api/backup", world=True)
def status(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json(app.WORLD_BACKUPS.status(request.world.backup))


@get("/api/log", world=True)
def history(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json({"ok": True, "commits": app.WORLD_BACKUPS.history(request.world.backup)})


@get("/api/backups", world=True)
def local_backups(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json({"ok": True, "backups": storage.list_backups(request.world.backups_dir)})


@get("/api/diff", world=True)
def diff(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    text_only = request.param("alles", "0") != "1"
    by_word = request.param("modus", "wort") == "wort"
    with app._lock:
        handler.send_json(app.WORLD_BACKUPS.diff(request.world.backup, ref, text_only, by_word))


@get("/api/textfassung", world=True)
def chapter_version(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    title = request.param("titel")
    chapter = request.param("kapitel")
    if not chapter.isdigit():
        return handler.send_json({"ok": False, "grund": "Kapitel fehlt."})
    with app._lock:
        handler.send_json(
            app.WORLD_BACKUPS.chapter_version(
                request.world.backup, ref, int(chapter), safe_name(title)
            )
        )


@get("/api/backup/remote")
def remote_worlds(handler, request: Request, app) -> None:
    """Deliberately not world-scoped: this is what a fresh install calls before
    it has any world at all, to find out what can be restored."""
    endpoint = backup_remote.default_endpoint()
    if not endpoint:
        return handler.send_json(
            {"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."}
        )
    try:
        handler.send_json(
            {"ok": True, "endpoint": endpoint, "worlds": backup_remote.worlds(endpoint)}
        )
    except Exception as exc:
        handler.send_json({"ok": False, "grund": str(exc)})


@save("/api/backup")
def snapshot(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:
        payload = {}
    # Before reading the rest of the body: a payload that names no world of the
    # caller's is answered here and nothing else about it matters.
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    message = (payload.get("message") or "").strip()
    push = bool(payload.get("push"))

    with app._lock:
        result = app.WORLD_BACKUPS.commit(world.backup, message, push)

    for line in result.get("log", []):
        print(f"  · {datetime.now():%H:%M:%S}  {line}")
    if not result.get("ok"):
        print(f"  ! Sicherung: {result.get('grund', '')}".replace("\n", " "))
    handler.send_json(result)


@save("/api/backup/restore")
def restore_from_endpoint(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:
        payload = {}
    world_id = str(payload.get("worldId", ""))
    snapshot_id = str(payload.get("snapshotId", ""))
    if not storage.WORLD_ID_RE.fullmatch(world_id):
        return handler.send_json({"ok": False, "grund": "Invalid world id."}, 400)
    endpoint = backup_remote.default_endpoint()
    if not endpoint:
        return handler.send_json(
            {"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."}
        )
    try:
        with app._lock:
            handler.send_json(
                app.restore_world_from_endpoint(request.session, world_id, snapshot_id, endpoint)
            )
    except Exception as exc:
        handler.send_json({"ok": False, "grund": str(exc)}, 400)


@save("/api/backups/restore")
def restore_local(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception as exc:
        return handler.send_json({"ok": False, "fehler": str(exc)}, 400)
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    try:
        with app._lock:
            storage.restore_backup(
                str(payload.get("name", "")), db_path=world.db_path, backups_dir=world.backups_dir
            )
            manuscript = storage.load_manuscript(world.db_path)
            figures = storage.load_figures(world.db_path)
            mirror_text(manuscript["chapters"], manuscript_dir=world.manuscripts_dir)
            mirror_profiles(figures, profile_dir=world.profiles_dir)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)


# --------------------------------------------------- Signing in to the endpoint
#
# The registration metadata of the four routes below, and why each is what it is:
#
#   - none is `world=True`. A login belongs to the *endpoint* and to the person
#     at this machine, not to a world: one credential opens every world's
#     backups, and demanding a `?world=` here would invent a scope the stored
#     token does not have (backend/backup_login.py files tokens by endpoint).
#     They do read an *optional* `?world=`, which is a different question: not
#     "whose login is this" but "which endpoint are we talking about", since a
#     world may name one of its own. See _endpoint_for. Optional matters -- a
#     machine with no worlds at all is exactly who calls this first.
#   - none is `anonymous=True`. Starting a flow that ends in a credential on
#     this disk, and redeeming the code that comes back, is the local user's
#     business; anonymous would hand both to anything that reaches the port. The
#     desktop case loses nothing by it -- a loopback request already resolves to
#     that user (backend/identity.py).
#   - none is `auth_only=True`, and that one is worth saying plainly because the
#     word invites the opposite guess. `auth_only` means "exists only where
#     there is more than one user". These are the reverse: the browser flow is
#     precisely what the *single*-user build needs, while a hosted instance has
#     nothing to do here because its session already carries the token
#     (server._backup_token). Both deployments answer; they answer differently.


def _redirect_uri(handler) -> str:
    """The loopback URL the issuer sends the browser back to (RFC 8252).

    Read off the listening socket rather than configured: the port is chosen at
    startup (and is "whatever was free" in the tests), so anything written down
    would be wrong the first time somebody runs `python3 server.py 8080`.
    Literal 127.0.0.1 rather than the request's Host, because this string is
    also what the login is bound to and what the token exchange must repeat --
    it has to mean one address, not whatever name the browser used.
    """
    return f"http://127.0.0.1:{handler.server.server_address[1]}/backup/callback"


def _page(handler, message: str, code: int) -> None:
    """A callback failure the browser can read.

    This is the one route a *browser* lands on directly, so a JSON body would
    show the user a line of punctuation and an exception would show them our
    file names. A plain page and the reason it failed instead.
    """
    body = (
        '<!doctype html><meta charset="utf-8">'
        "<title>Quiltor — Anmeldung</title>"
        '<body style="font:16px system-ui;margin:3rem;max-width:34rem">'
        "<h1>Die Anmeldung ist nicht angekommen</h1>"
        f"<p>{html.escape(message)}</p>"
        '<p><a href="/">Zurück zu Quiltor</a></p>'
    ).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _endpoint_for(request: Request, app) -> str:
    """The endpoint this request is about.

    A world may carry its own `backupUrl` instead of the account-wide one, and
    the snapshot dialog shows that world's target and asks about the login in the
    same breath. Reading the account-wide setting here regardless would let it
    answer "signed in" about a different server than the one the upload goes to
    -- true and useless at the same time. So the world decides when it names one,
    and only otherwise does the account-wide setting.

    Resolution failures fall through to the default on purpose: this route is
    also the one a machine with no worlds at all calls, and refusing to answer
    because a world id was unusable would break the very case that needs it.
    """
    world_id = request.param("world")
    if world_id:
        try:
            # BackupContext already falls back to the account-wide endpoint when
            # the world names none (SnapshotStore.context), so this is resolved.
            return app.resolve_world(request.session, world_id).backup.endpoint_url
        except Exception:
            pass
    return backup_remote.default_endpoint()


@get("/api/backup/login")
def login_status(handler, request: Request, app) -> None:
    """Where this instance stands with the backup endpoint's login.

    Two deployments, two truthful answers. Hosted, the session already holds an
    access token from the very issuer that guards the endpoint, so there is
    nothing to sign in to: the answer is "signed in" without a single network
    call, and `hosted` tells the dialog to offer no button. Locally the answer
    comes from the stored login, where `issuerReachable` separates "you are not
    signed in" from "nobody could sign in right now".
    """
    endpoint = _endpoint_for(request, app)
    if not endpoint:
        # Not an error: a Quiltor that backs up nowhere is a normal Quiltor, and
        # the dialog has to say so rather than show a login that leads nowhere.
        return handler.send_json(
            {
                "ok": True,
                "configured": False,
                "hosted": app.IDENTITY.multi_user,
                "endpoint": "",
                "signedIn": False,
            }
        )
    if app.IDENTITY.multi_user:
        session = request.session
        # Checked, not claimed. The session is what carries the credential here,
        # and it can carry none: one minted by a render token never had provider
        # tokens, and a refresh that failed clears them. Answering "signed in"
        # for those meant the dialog offered an upload that could only 401, with
        # nothing on screen admitting why. app.session_backup_token also renews
        # a token that has simply lapsed, so asking is what keeps the answer
        # true rather than merely once-true.
        usable = bool(app.session_backup_token(session))
        return handler.send_json(
            {
                "ok": True,
                "configured": True,
                "hosted": True,
                "endpoint": endpoint,
                "signedIn": usable,
                "account": session.sub,
                "email": session.email,
                "name": session.name,
                "issuer": auth.ISSUER,
                "scope": "",
                # Asserted rather than probed: the login that produced this session
                # went through that issuer, and a "no" here would be actionable by
                # nobody, since this deployment has no second login to offer.
                "issuerReachable": True,
                **(
                    {}
                    if usable
                    else {
                        # The only remedy this deployment has, so it is the one named.
                        "grund": "This session carries no valid token for the backup endpoint any more. "
                        "Sign out and sign in again to get one."
                    }
                ),
            }
        )
    handler.send_json(
        {"ok": True, "configured": True, "hosted": False, **backup_login.status(endpoint)}
    )


@save("/api/backup/login")
def login_begin(handler, request: Request, app) -> None:
    """Start the browser flow and hand back the URL to open.

    Deliberately not a 302: the caller is a `fetch` from the backup dialog, not
    a page navigation, so a redirect would be followed by the fetch itself and
    the issuer's login form would arrive as a response body nobody ever sees.
    The dialog opens the returned URL in a real browser window, which is the
    only place a login form belongs.
    """
    if app.IDENTITY.multi_user:
        # There is no browser flow here to start -- see login_status. Answered
        # 200 with ok=False, like every other "there is nothing to do here" on
        # this route: the caller did nothing wrong, so a 4xx would make the
        # dialog both catch an exception and read a field for the same class of
        # answer. One shape for every refusal it can encounter.
        return handler.send_json(
            {
                "ok": False,
                "grund": "This instance signs its users in itself, and the backup "
                "endpoint accepts that session.",
            }
        )
    endpoint = _endpoint_for(request, app)
    if not endpoint:
        return handler.send_json(
            {"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."}
        )
    try:
        authorize_url = backup_login.begin(endpoint, _redirect_uri(handler))
    except Exception as exc:
        # An unreachable endpoint, or one that publishes no issuer: both are the
        # user's to fix, and both read better as one sentence than as a 500.
        return handler.send_json({"ok": False, "grund": str(exc)})
    handler.send_json(
        {
            "ok": True,
            "endpoint": endpoint,
            "authorizeUrl": authorize_url,
            "redirectUri": _redirect_uri(handler),
        }
    )


@save("/api/backup/logout")
def login_end(handler, request: Request, app) -> None:
    """Drop the stored credential. Local in both senses: the token stays valid at
    the issuer until it expires or is revoked there, and a hosted session has
    nothing of its own to drop -- signing that one out is `/logout`."""
    endpoint = _endpoint_for(request, app)
    if endpoint and not app.IDENTITY.multi_user:
        backup_login.sign_out(endpoint)
    handler.send_json({"ok": True, "signedIn": False})


@get("/backup/callback")
def login_callback(handler, request: Request, app) -> None:
    """Where the issuer sends the browser back with the authorization code.

    Checking `state` is `backup_login.complete`'s first act, and it is left
    there on purpose: the pending record is single-use *by being popped*, so
    consuming it here and completing afterwards would either pop it twice or
    open a window between the two checks. What this route adds is the redirect
    the login was started on -- rebuilt from the port we are listening on, and
    compared inside `complete` against the one that login recorded -- and an
    answer a browser can read.
    """
    if request.param("error"):
        return _page(handler, f"Der Anbieter hat abgelehnt: {request.param('error')}", 400)
    code, state = request.param("code"), request.param("state")
    if not code or not state:
        return _page(handler, "Die Rückleitung trug keinen Code.", 400)
    try:
        backup_login.complete(code, state, _redirect_uri(handler))
    except ValueError as exc:
        # An unknown state is the interesting one: somebody else's login being
        # pushed onto this machine arrives looking exactly like this.
        return _page(handler, str(exc), 400)
    except Exception as exc:
        return _page(handler, f"Der Anbieter hat den Code nicht eingelöst: {exc}", 502)
    # Back into the app rather than onto a success page: the dialog that started
    # this is still open in the other window and its next status poll shows the
    # account. A page saying "you may close this tab now" is one more thing to
    # read and nothing more.
    handler.send_redirect("/")
