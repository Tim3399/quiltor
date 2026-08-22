from __future__ import annotations

import hashlib
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

from quiltor.infrastructure.platform import process_supervisor, system
from quiltor.modules.writing_assistance.grammar.contract import (
    JAVA_MINIMUM,
    LANGUAGETOOL_SHA256,
    LANGUAGETOOL_URL,
    LANGUAGETOOL_VERSION,
)


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


class LanguageToolManager:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "writing-assistance" / f"LanguageTool-{LANGUAGETOOL_VERSION}"
        self.java = shutil.which("java")
        self.process: subprocess.Popen | None = None
        self.port: int | None = None
        self.lock = threading.RLock()

    @property
    def server_jar(self) -> Path:
        return self.root / "languagetool-server.jar"

    def status(self) -> dict:
        java_version = _java_version(self.java)
        configured_url = os.environ.get("QUILTOR_LANGUAGETOOL_URL", "").strip()
        external_opt_in = os.environ.get("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN") == "1"
        running = self.process is not None and self.process.poll() is None
        return {
            # `supported` is the edition's verdict, `available` this machine's:
            # supported-but-unavailable means "install Java and click the
            # button", unsupported means the button should not exist. See
            # src/quiltor/modules/writing_assistance/grammar/unavailable.py.
            "supported": True,
            "unsupportedReason": "",
            "available": self.server_jar.exists()
            and java_version is not None
            and java_version >= JAVA_MINIMUM,
            "installed": self.server_jar.exists(),
            "running": running,
            "version": LANGUAGETOOL_VERSION,
            "javaVersion": java_version,
            "javaRequired": JAVA_MINIMUM,
            "externalConfigured": bool(configured_url),
            "externalEnabled": bool(configured_url and external_opt_in),
            "download": {
                "url": LANGUAGETOOL_URL,
                "checksum": f"sha256:{LANGUAGETOOL_SHA256}",
                "license": "LGPL-2.1-or-later",
            },
        }

    def install(self) -> dict:
        java_version = _java_version(self.java)
        if java_version is None or java_version < JAVA_MINIMUM:
            raise RuntimeError(f"Java {JAVA_MINIMUM} oder neuer ist erforderlich")
        request = urllib.request.Request(
            LANGUAGETOOL_URL, headers={"User-Agent": "Quiltor local installer"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
        if hashlib.sha256(payload).hexdigest() != LANGUAGETOOL_SHA256:
            raise ValueError("LanguageTool checksum mismatch")
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
        with self.lock:
            if self.process is not None and self.process.poll() is None and self.port:
                return f"http://127.0.0.1:{self.port}/v2/check"
            status = self.status()
            if not status["available"]:
                raise FileNotFoundError("LanguageTool ist nicht installiert oder Java fehlt")
            with socket.socket() as candidate:
                candidate.bind(("127.0.0.1", 0))
                self.port = candidate.getsockname()[1]
            self.process = process_supervisor().spawn(
                [
                    self.java,
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
            raise RuntimeError("LanguageTool konnte nicht gestartet werden")

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        if language != "de-DE" or not text or len(text) > 200_000:
            raise ValueError("invalid grammar check")
        external_url = os.environ.get("QUILTOR_LANGUAGETOOL_URL", "").strip()
        if external_url:
            if os.environ.get("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN") != "1":
                raise PermissionError("Externe Grammatikprüfung ist nicht freigegeben")
            url = external_url.rstrip("/") + "/v2/check"
        else:
            url = self._local_url()
        body = urllib.parse.urlencode({"language": language, "text": text}).encode()
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Quiltor local grammar",
            },
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
        own = {word.casefold() for word in custom_words if isinstance(word, str)}
        issues = []
        for index, match in enumerate(result.get("matches", [])):
            start, length = int(match.get("offset", -1)), int(match.get("length", 0))
            if (
                start < 0
                or length <= 0
                or start + length > len(text)
                or text[start : start + length].casefold() in own
            ):
                continue
            rule = match.get("rule") or {}
            category = rule.get("category") or {}
            seed = f"{start}:{length}:{rule.get('id', '')}:{index}".encode()
            issues.append(
                {
                    "id": hashlib.sha1(seed).hexdigest()[:16],
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
        return {"ok": True, "language": language, "issues": issues}

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
