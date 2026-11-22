"""Open the real desktop window under a CSP mode and prove that it still works (T-272).

D-198 keeps the desktop on `report-only` because pywebview builds its bridge with
`new Function` and hands results back through `eval`. Whether WebView2 (Windows) and
WKWebView (macOS) apply the page's policy to those is a question for the real engine, so
this starts the same pieces app.main() starts -- server thread, NativeBridge, a pywebview
window on owner_url() -- and drives the page from Python:

  1. the page loads through `?token=`, the redirect strips the token, the app renders,
     and an API call with the cookie answers 200 (S269-4 in the real window);
  2. the policy header is the one asked for;
  3. `pywebview.api.invoke` saves files through the bridge, small and export-sized
     (every export -- book PDF, manuscript, project -- goes through this one call);
  4. the backup login's window half: its fetch answers, and the system browser is reached
     both by window.open (what the app does) and by a target=_blank link (captured
     here instead of opening one);
  5. no `securitypolicyviolation` fired while steps 3 and 4 ran.

Each step lands in a JSON report with time, build and result. Exit code 0 means every
step passed. Run it from a desktop environment that has the `desktop` extra:

    python tools/dev/desktop_csp_probe.py --mode enforce --report probe.json

Developer tool only: nothing here ships, and it never touches a real profile -- data,
home and saved files all live in a temporary directory.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import webbrowser
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

LARGE_BYTES = 8 * 1024 * 1024  # about a long book PDF; the bridge accepts up to 140 MB


class Probe:
    def __init__(self, mode: str, timeout: float) -> None:
        self.mode = mode
        self.timeout = timeout
        self.steps: list[dict[str, Any]] = []
        self.opened_externally: list[str] = []
        # "passed", "failed", or "bridge-blocked-by-csp" when the engine refuses injected script.
        self.outcome = ""
        self.saved_dir = Path(tempfile.mkdtemp(prefix="quiltor-csp-probe-saved-"))
        # What must never reach the report, which CI uploads: the process token, and the
        # directories of this machine (home, temp, the probe's own folders).
        self.secrets: list[str] = []
        self.paths: list[str] = [str(self.saved_dir), tempfile.gettempdir(), str(Path.home())]

    def redact(self, value: Any) -> Any:
        text = json.dumps(value, ensure_ascii=False)
        text = re.sub(r"([?&]token=)[^&\"#\s]*", r"\1<token>", text)
        for secret in self.secrets:
            if secret:
                text = text.replace(json.dumps(secret)[1:-1], "<token>")
        # Longest first, so a folder inside the home directory is named before the home itself.
        for path in sorted({p for p in self.paths if p}, key=len, reverse=True):
            for form in {path, path.replace("\\", "/")}:
                text = text.replace(json.dumps(form)[1:-1], "<local>")
        return json.loads(text)

    def step(self, name: str, ok: bool, detail: Any = None) -> bool:
        detail = self.redact(detail)
        self.steps.append(
            {
                "step": name,
                "ok": bool(ok),
                "at": datetime.now(UTC).isoformat(timespec="seconds"),
                "detail": detail,
            }
        )
        print(f"[{'ok' if ok else 'FAIL'}] {name}: {detail}", flush=True)
        return ok


def _git_head() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _build(webview: Any) -> dict[str, str]:
    from importlib import metadata

    version_file = ROOT / "VERSION"
    return {
        "quiltor": version_file.read_text(encoding="utf-8").strip()
        if version_file.exists()
        else "",
        "commit": _git_head(),
        "pywebview": metadata.version("pywebview"),
        "gui": str(getattr(webview, "guilib", "") or ""),
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "python": platform.python_version(),
    }


_SLOT = 0


def _evaluate(window: Any, script: str, timeout: float = 60.0) -> Any:
    """The value of `script`, a promise resolved first.

    evaluate_js hands a promise back as `{}` under WebView2, so the page parks the
    settled value in a slot of its own and Python reads that slot until it is filled.
    """
    global _SLOT
    _SLOT += 1
    slot = f"__probe{_SLOT}"
    window.evaluate_js(
        f"window.{slot} = undefined;"
        f"Promise.resolve().then(() => ({script}))"
        f".then((v) => {{ window.{slot} = JSON.stringify({{ v: v === undefined ? null : v }}); }},"
        f" (e) => {{ window.{slot} = JSON.stringify({{ error: String(e) }}); }}); true"
    )
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        raw = window.evaluate_js(f"window.{slot} === undefined ? null : window.{slot}")
        if isinstance(raw, str):
            settled = json.loads(raw)
            if "error" in settled:
                raise RuntimeError(f"page script failed: {settled['error']}")
            return settled["v"]
        time.sleep(0.1)
    raise TimeoutError(f"page script did not settle within {timeout:.0f}s")


def _invoke_save(window: Any, name: str, size: int) -> Any:
    script = f"""
    (() => {{
      const bytes = new Uint8Array({size});
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {{
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }}
      return window.pywebview.api.invoke({{
        version: 1, id: {json.dumps(name)}, operation: "file.save",
        payload: {{ name: {json.dumps(name)}, content: btoa(binary), encoding: "base64" }}
      }}).then((answer) => JSON.stringify(answer));
    }})()
    """
    answer = _evaluate(window, script)
    return json.loads(answer) if isinstance(answer, str) else answer


def run_steps(window: Any, probe: Probe) -> None:
    try:
        loaded = window.events.loaded.wait(probe.timeout)
        if not probe.step("window loaded", loaded, window.get_current_url()):
            return
        # The redirect after ?token= may still be on its way; wait for the app to render.
        deadline = time.monotonic() + probe.timeout
        rendered = False
        while time.monotonic() < deadline:
            rendered = bool(
                _evaluate(
                    window,
                    "!location.search.includes('token=') && "
                    "document.getElementById('root') && "
                    "document.getElementById('root').children.length > 0",
                )
            )
            if rendered:
                break
            time.sleep(0.25)
        probe.step("app rendered, token gone from the address", rendered, window.get_current_url())

        status = _evaluate(window, "fetch('/api/worlds').then((r) => r.status)")
        probe.step("API answers with the owner's cookie", status == 200, status)
        created = _evaluate(
            window,
            "fetch('/api/worlds/create', {method: 'POST', headers: {'Content-Type':"
            " 'application/json'}, body: JSON.stringify({title: 'CSP-Probe', backupUrl: ''})})"
            ".then((r) => r.status)",
        )
        probe.step("a write (create world) is saved", created == 200, created)

        header = _evaluate(
            window,
            "fetch('/').then((r) => JSON.stringify({"
            "enforce: r.headers.get('content-security-policy'),"
            "reportOnly: r.headers.get('content-security-policy-report-only'),"
            "frame: r.headers.get('x-frame-options')}))",
        )
        headers = json.loads(header) if isinstance(header, str) else {}
        wanted = "enforce" if probe.mode == "enforce" else "reportOnly"
        probe.step(f"policy header is {probe.mode}", bool(headers.get(wanted)), headers)

        _evaluate(
            window,
            "(() => { window.__violations = [];"
            " document.addEventListener('securitypolicyviolation', (e) =>"
            " window.__violations.push(e.effectiveDirective + ' ' + e.blockedURI + ' ' + "
            "(e.sourceFile || '') + ':' + e.lineNumber)); return true; })()",
        )

        # Control, so that a silent policy or a deaf listener cannot pass the steps below.
        # Script run through evaluate_js is not held to the page's script-src under WebView2
        # (a `new Function` from here ran under enforce), so the control asks the document
        # instead: an image from a foreign origin breaks img-src, and the report names the
        # disposition the policy was applied with.
        disposition = _evaluate(
            window,
            "new Promise((resolve) => {"
            " const seen = (e) => { document.removeEventListener('securitypolicyviolation', seen);"
            " resolve(e.disposition + ' ' + e.effectiveDirective); };"
            " document.addEventListener('securitypolicyviolation', seen);"
            " const img = new Image(); img.src = 'https://probe.example.test/pixel.png';"
            " document.body.appendChild(img);"
            " setTimeout(() => resolve('none'), 5000); })",
        )
        expected = ("enforce" if probe.mode == "enforce" else "report") + " img-src"
        probe.step(
            f"control: a foreign image is reported as {expected}",
            disposition == expected,
            disposition,
        )
        _evaluate(window, "(window.__violations = [], true)")

        api = _evaluate(window, "typeof (window.pywebview && window.pywebview.api.invoke)")
        probe.step("bridge is present on the page", api == "function", api)

        for name, size in (("probe-small.txt", 64), ("probe-export.pdf", LARGE_BYTES)):
            answer = _invoke_save(window, name, size)
            written = probe.saved_dir / name
            ok = (
                isinstance(answer, dict)
                and answer.get("ok") is True
                and written.is_file()
                and written.stat().st_size == size
            )
            probe.step(f"bridge saves {name} ({size} bytes)", ok, answer)

        login = _evaluate(
            window,
            "fetch('/api/backup/login', {method: 'POST', headers: {'Content-Type': "
            "'application/json'}, body: '{}'}).then((r) => r.status)",
        )
        # Without a configured endpoint the server answers 4xx; what counts here is that
        # the request left the page at all under the policy.
        probe.step("backup login request leaves the page", isinstance(login, int), login)
        # Two ways out of the window, measured apart. The app's sign-in button calls
        # window.open (platform/browser/browserPlatformGateway.ts); pywebview's Cocoa backend
        # hands only an activated link to the system browser and drops a scripted window.open.
        _evaluate(
            window, "(window.open('https://issuer.example.test/by-window-open', '_blank'), true)"
        )
        time.sleep(1.0)
        probe.step(
            "backup login: window.open (as the app does) reaches the system browser",
            any("by-window-open" in url for url in probe.opened_externally),
            probe.opened_externally,
        )
        _evaluate(
            window,
            "(() => { const a = document.createElement('a');"
            " a.href = 'https://issuer.example.test/by-link'; a.target = '_blank';"
            " a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click();"
            " a.remove(); return true; })()",
        )
        time.sleep(1.0)
        probe.step(
            "backup login: a target=_blank link reaches the system browser",
            any("by-link" in url for url in probe.opened_externally),
            probe.opened_externally,
        )

        violations = _evaluate(window, "JSON.stringify(window.__violations)")
        found = json.loads(violations) if isinstance(violations, str) else violations
        probe.step("no CSP violation during bridge and login", found == [], found)
    except Exception as error:  # noqa: BLE001 -- the report must say what broke, then close
        message = str(error)
        if "unsafe-eval" in message or "EvalError" in message:
            # WKWebView holds script pywebview injects to the page's script-src. evaluate_js is
            # also how pywebview hands every bridge result back (webview/window.py), so the
            # bridge is blocked the same way: a result, not a crash of the probe.
            probe.outcome = "bridge-blocked-by-csp"
            probe.step("page scripting and the bridge are refused by the CSP", False, message)
        else:
            probe.step("probe crashed", False, traceback.format_exc())
    finally:
        window.destroy()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n", 1)[0])
    parser.add_argument("--mode", choices=("enforce", "report-only"), default="enforce")
    parser.add_argument("--report", type=Path, default=Path("desktop-csp-probe.json"))
    parser.add_argument("--timeout", type=float, default=60.0)
    options = parser.parse_args(argv)

    home = Path(tempfile.mkdtemp(prefix="quiltor-csp-probe-home-"))
    os.environ["QUILTOR_CSP"] = options.mode
    os.environ["QUILTOR_RUNTIME_HOST"] = "desktop"
    os.environ["QUILTOR_HOME"] = str(home)
    os.environ["QUILTOR_DATA_DIR"] = str(home / "data")
    os.environ["QUILTOR_HOST"] = "127.0.0.1"

    import webview  # pyright: ignore[reportMissingImports] -- desktop extra

    from quiltor.hosts.desktop import app as desktop
    from quiltor.hosts.desktop.bridge import NativeBridge
    from quiltor.hosts.web import server
    from quiltor.infrastructure.platform.ports import AppDirectories

    probe = Probe(options.mode, options.timeout)
    probe.paths += [str(home), str(ROOT)]
    directories = AppDirectories(
        data=home / "data",
        config=home / "config",
        cache=home / "cache",
        models=home / "models",
        logs=home / "logs",
        temp=home / "temp",
    )
    application = server.build_web_application(
        app_directories=directories, ensure_assistant_installed=False
    )
    port = desktop._free_port()
    threading.Thread(
        target=server.run,
        kwargs={"port": port, "no_open": True, "application": application},
        daemon=True,
    ).start()
    desktop._wait_until_ready(port)
    probe.secrets.append(str(getattr(application.identity, "token", "")))

    # pywebview hands window.open to the system browser through webbrowser.open.
    webbrowser.open = lambda url, *args, **kwargs: probe.opened_externally.append(url) or True
    desktop.keep_pywebview_downloads_off(webview)
    bridge = NativeBridge(application.capabilities, directory=probe.saved_dir)
    bridge.choose_path = lambda name: str(probe.saved_dir / name)  # type: ignore[method-assign]
    window = webview.create_window(
        "Quiltor CSP probe",
        desktop.owner_url(port, application.identity),
        width=1100,
        height=760,
        js_api=bridge,
    )
    bridge.attach(window)
    build = _build(webview)
    webview.start(run_steps, (window, probe), private_mode=True, debug=False)

    report = probe.redact(
        {
            "mode": options.mode,
            "build": build,
            "steps": probe.steps,
            "passed": bool(probe.steps) and all(step["ok"] for step in probe.steps),
        }
    )
    report["outcome"] = probe.outcome or ("passed" if report["passed"] else "failed")
    written = json.dumps(report, indent=2, ensure_ascii=False)
    # Last line of defence before the file can be uploaded: no token, no local directory.
    leaked = [secret for secret in probe.secrets if secret and secret in written]
    leaked += [
        local
        for local in probe.paths
        if local and (json.dumps(local)[1:-1] in written or local.replace("\\", "/") in written)
    ]
    if leaked:
        print("report withheld: it still names the token or a local directory", file=sys.stderr)
        return 2
    options.report.write_text(written, encoding="utf-8")
    print(f"report: {options.report.resolve()}  passed={report['passed']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
