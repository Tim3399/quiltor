"""What the client may offer on this server (T-102, D-58, D-59).

One frontend serves every operation profile. The client branches on these flags
and never on a profile name, which is why the profile is not on the wire.
`instance` is the same for everyone on the server; `user` belongs to the asking
session and stays empty until its first flag ships. The contract is
contracts/application-api/capabilities/v1.schema.json.

Authenticated like /api/whoami: the dispatch answers 401 without a session, and
every JSON answer already carries `Cache-Control: no-store`.
"""

from __future__ import annotations

from quiltor.delivery.http.routes import Request, get


@get("/api/capabilities")
def capabilities(handler, request: Request, app) -> None:
    handler.send_json(
        {
            "ok": True,
            "version": 1,
            "instance": {
                "multiUser": app.multi_user,
                # Today the same fact as multiUser, named for what the client offers.
                "signOut": app.multi_user,
                "deviceSync": app.syncable,
                "assistantInstall": app.assistant_install,
                "writingDataInstall": app.writing_data_install,
                "grammarInstall": app.grammar_install,
            },
            "user": {},
        }
    )
