"""Send a request whose body arrives only after the server has read its headers.

That is the order in which a refused request's body ends up unread in the socket. On
Windows, closing a socket with unread bytes resets the connection, and the client loses
the answer that was already on its way (WinError 10053). Over http.client the body
usually rides in the same read as the headers and the reset happens now and then; sent
like this, it happens every time the server forgets to discard the body.
"""

from __future__ import annotations

import json
import socket
import time
from dataclasses import dataclass

DEADLINE_SECONDS = 5.0


@dataclass(frozen=True)
class Answer:
    status: int
    headers: dict[str, str]
    body: bytes
    elapsed: float

    def json(self):
        return json.loads(self.body)


def send(
    port: int,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes = b"",
    length: str | None = "auto",
    pause: float = 0.05,
) -> Answer:
    """`length="auto"` declares len(body); None leaves Content-Length out."""
    headers = {"Host": "127.0.0.1", **(headers or {})}
    lines = [f"{method} {path} HTTP/1.1"]
    lines += [f"{key}: {value}" for key, value in headers.items()]
    if length == "auto":
        length = str(len(body))
    if length is not None:
        lines.append(f"Content-Length: {length}")
    head = ("\r\n".join(lines) + "\r\n\r\n").encode()
    with socket.create_connection(("127.0.0.1", port), timeout=DEADLINE_SECONDS) as client:
        started = time.monotonic()
        client.sendall(head)
        time.sleep(pause)
        if body:
            client.sendall(body)
        client.shutdown(socket.SHUT_WR)
        raw = b""
        while chunk := client.recv(65536):
            raw += chunk
        elapsed = time.monotonic() - started
    head_bytes, _, payload = raw.partition(b"\r\n\r\n")
    status_line, *header_lines = head_bytes.decode("iso-8859-1").split("\r\n")
    parsed = {}
    for line in header_lines:
        key, _, value = line.partition(":")
        parsed[key.strip().lower()] = value.strip()
    return Answer(int(status_line.split()[1]), parsed, payload, elapsed)
