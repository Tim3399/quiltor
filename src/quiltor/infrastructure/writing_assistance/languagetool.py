from __future__ import annotations

import hashlib
import http.client
import io
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import cast

from quiltor.infrastructure.platform import process_supervisor, system
from quiltor.modules.writing_assistance.errors import (
    ChecksumMismatch,
    DownloadFailed,
    GrammarStartFailed,
    GrammarUnavailable,
    JavaMissing,
)
from quiltor.modules.writing_assistance.grammar.contract import (
    JAVA_MINIMUM,
    LANGUAGETOOL_SHA256,
    LANGUAGETOOL_URL,
    LANGUAGETOOL_VERSION,
)

# Characters per request to LanguageTool. A 200k chapter took 18 s on a fast
# machine as a single request, close to the timeout, and a shared host is
# slower; 20k sections stay at a few seconds each.
GRAMMAR_SECTION_LIMIT = 20_000
# Seconds to wait for one section's reply.
GRAMMAR_SECTION_TIMEOUT = 20

_SENTENCE_END = re.compile(r"[.!?…][\"'»«“”)]*\s")


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _utf16_slice(text: str, start: int, length: int) -> str:
    raw = text.encode("utf-16-le")[2 * start : 2 * (start + length)]
    return raw.decode("utf-16-le", errors="replace")


def _sections(text: str, limit: int) -> list[str]:
    """Split text into consecutive pieces of at most `limit` characters that
    join back to the text. Cuts after a blank line, else after a line break,
    else after a sentence end, else at the limit itself."""
    sections = []
    rest = text
    while len(rest) > limit:
        window = rest[:limit]
        cut = window.rfind("\n\n")
        cut = cut + 2 if cut > 0 else 0
        if not cut:
            cut = window.rfind("\n") + 1
        if not cut:
            ends = list(_SENTENCE_END.finditer(window))
            cut = ends[-1].end() if ends else limit
        sections.append(rest[:cut])
        rest = rest[cut:]
    sections.append(rest)
    return sections


def _java_version(java: str | None) -> int | None:
    if not java:
        return None
    try:
        result = subprocess.run(
            [java, "-version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            creationflags=system.spawn_flags(),
        )
        match = re.search(r'version "(?:1\.)?(\d+)', result.stderr + result.stdout)
        return int(match.group(1)) if match else None
    except (OSError, subprocess.SubprocessError):
        return None


def _safe_extract(archive: zipfile.ZipFile, target: Path) -> None:
    root = target.resolve()
    for member in archive.infolist():
        destination = (target / member.filename).resolve()
        if root not in destination.parents and destination != root:
            raise ValueError("unsafe LanguageTool archive")
    archive.extractall(target)


def external_grammar_enabled() -> bool:
    """An external LanguageTool server is configured and explicitly enabled."""
    return bool(
        os.environ.get("QUILTOR_LANGUAGETOOL_URL", "").strip()
        and os.environ.get("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN") == "1"
    )


class LanguageToolManager:
    def __init__(self, data_dir: Path, *, local: bool = True):
        # local=False is the external server only, for builds that may neither
        # download LanguageTool nor start Java: no `java -version`, no install,
        # no spawn. See infrastructure/writing_assistance/factory.py.
        self.local = local
        self.root = data_dir / "writing-assistance" / f"LanguageTool-{LANGUAGETOOL_VERSION}"
        self.java = shutil.which("java") if local else None
        self.process: subprocess.Popen | None = None
        self.port: int | None = None
        self.lock = threading.RLock()

    @property
    def server_jar(self) -> Path:
        return self.root / "languagetool-server.jar"

    def status(self) -> dict:
        java_version = _java_version(self.java) if self.local else None
        configured_url = os.environ.get("QUILTOR_LANGUAGETOOL_URL", "").strip()
        external_opt_in = os.environ.get("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN") == "1"
        running = self.process is not None and self.process.poll() is None
        external_enabled = bool(configured_url and external_opt_in)
        local_available = (
            self.local
            and self.server_jar.exists()
            and java_version is not None
            and java_version >= JAVA_MINIMUM
        )
        return {
            # `supported` is the edition's verdict, `available` this machine's:
            # supported-but-unavailable means "install Java and click the
            # button", unsupported means the button should not exist. See
            # src/quiltor/modules/writing_assistance/grammar/unavailable.py.
            "supported": True,
            "unsupportedReason": "",
            # A configured and enabled external server replaces the local one
            # entirely (check() never falls back), so Java and the JAR stop
            # mattering for availability.
            "available": external_enabled or local_available,
            "installed": self.local and self.server_jar.exists(),
            "running": running,
            "version": LANGUAGETOOL_VERSION,
            "javaVersion": java_version,
            "javaRequired": JAVA_MINIMUM,
            "externalConfigured": bool(configured_url),
            "externalEnabled": external_enabled,
            "download": {
                "url": LANGUAGETOOL_URL,
                "checksum": f"sha256:{LANGUAGETOOL_SHA256}",
                "license": "LGPL-2.1-or-later",
            },
        }

    def install(self) -> dict:
        if not self.local:
            raise PermissionError("This Quiltor build cannot install LanguageTool locally")
        java_version = _java_version(self.java)
        if java_version is None or java_version < JAVA_MINIMUM:
            raise JavaMissing(params={"required": JAVA_MINIMUM})
        request = urllib.request.Request(
            LANGUAGETOOL_URL, headers={"User-Agent": "Quiltor local installer"}
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
        except (OSError, http.client.HTTPException) as exc:
            # URLError, HTTPError and socket timeouts are all OSError; a
            # connection closed mid-body is IncompleteRead, an HTTPException.
            raise DownloadFailed() from exc
        if hashlib.sha256(payload).hexdigest() != LANGUAGETOOL_SHA256:
            raise ChecksumMismatch()
        parent = self.root.parent
        parent.mkdir(parents=True, exist_ok=True)
        temporary = parent / f".{self.root.name}.installing"
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.mkdir()
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                _safe_extract(archive, temporary)
            extracted = temporary / self.root.name
            if not (extracted / "languagetool-server.jar").exists():
                raise ValueError("LanguageTool server is missing")
            if self.root.exists():
                shutil.rmtree(self.root)
            os.replace(extracted, self.root)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return {"ok": True, **self.status()}

    def _local_url(self) -> str:
        if not self.local:
            raise PermissionError("This Quiltor build cannot start LanguageTool locally")
        with self.lock:
            if self.process is not None and self.process.poll() is None and self.port:
                return f"http://127.0.0.1:{self.port}/v2/check"
            status = self.status()
            if not status["installed"]:
                raise FileNotFoundError("LanguageTool is not installed")
            if not status["available"]:
                raise JavaMissing(params={"required": JAVA_MINIMUM})
            with socket.socket() as candidate:
                candidate.bind(("127.0.0.1", 0))
                self.port = candidate.getsockname()[1]
            self.process = process_supervisor().spawn(
                [
                    # `available` above implies a Java executable was found.
                    cast(str, self.java),
                    "-cp",
                    str(self.server_jar),
                    "org.languagetool.server.HTTPServer",
                    "--port",
                    str(self.port),
                ],
                cwd=self.root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            url = f"http://127.0.0.1:{self.port}/v2/check"
            for _ in range(40):
                if self.process.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/v2/languages", timeout=0.25
                    ):
                        return url
                except OSError:
                    time.sleep(0.1)
            self.close()
            raise GrammarStartFailed()

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        if language != "de-DE" or not text or len(text) > 200_000:
            raise ValueError("invalid grammar check")
        external_url = os.environ.get("QUILTOR_LANGUAGETOOL_URL", "").strip()
        if external_url:
            if os.environ.get("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN") != "1":
                raise PermissionError("External grammar checking is not enabled")
            url = external_url.rstrip("/") + "/v2/check"
        else:
            url = self._local_url()
        # One request per section, one after the other: each gets its own
        # timeout, so a long chapter on a slow host no longer runs into it as
        # a whole. Not in parallel, because LanguageTool is CPU-bound and the
        # shared host gains nothing from two checks fighting for the cores,
        # while memory use would double. Any failed section fails the whole
        # check; a partial list would look like a clean result.
        own = {word.casefold() for word in custom_words if isinstance(word, str)}
        issues = []
        index = 0
        base = 0  # UTF-16 offset of the section in the whole text
        for section in _sections(text, GRAMMAR_SECTION_LIMIT):
            for match in self._check_section(url, language, section):
                index += 1
                start, length = int(match.get("offset", -1)), int(match.get("length", 0))
                # LanguageTool counts UTF-16 code units (Java chars), and so
                # does the client (JavaScript strings); Python str does not.
                if (
                    start < 0
                    or length <= 0
                    or start + length > _utf16_length(section)
                    or _utf16_slice(section, start, length).casefold() in own
                ):
                    continue
                start += base
                rule = match.get("rule") or {}
                category = rule.get("category") or {}
                seed = f"{start}:{length}:{rule.get('id', '')}:{index - 1}".encode()
                issues.append(
                    {
                        "id": hashlib.sha1(seed, usedforsecurity=False).hexdigest()[:16],
                        "from": start,
                        "to": start + length,
                        "ruleId": str(rule.get("id", "")),
                        "category": str(category.get("name", "")),
                        "message": str(match.get("message", ""))[:1000],
                        "replacements": [
                            str(item.get("value", ""))
                            for item in match.get("replacements", [])[:8]
                            if item.get("value")
                        ],
                    }
                )
            base += _utf16_length(section)
        return {"ok": True, "language": language, "issues": issues}

    def _check_section(self, url: str, language: str, text: str) -> list:
        body = urllib.parse.urlencode({"language": language, "text": text}).encode()
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Quiltor local grammar",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=GRAMMAR_SECTION_TIMEOUT) as response:
                result = json.load(response)
        except (OSError, ValueError) as exc:
            # OSError covers unreachable, HTTPError (4xx/5xx) and timeouts;
            # ValueError a reply that is not JSON. The exception text may echo
            # the request, so only the code leaves this method.
            raise GrammarUnavailable() from exc
        if not isinstance(result, dict):
            raise GrammarUnavailable()
        matches = result.get("matches", [])
        return matches if isinstance(matches, list) else []

    def close(self) -> None:
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            self.process = None
            self.port = None
