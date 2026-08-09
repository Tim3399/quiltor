"""CLI entry point for `pip install quiltor`.

`quiltor` (or `quiltor run`) starts the server exactly like `python3 server.py`
does -- this module just adds a friendlier command surface and a persisted
config file (`~/.quiltor/config.env`) so `QUILTOR_*` settings (Keycloak,
external LLM endpoint, ...) survive between runs instead of having to be
re-exported by hand every time.

Real environment variables always win over the persisted file: `_load_config`
uses `setdefault`, so `QUILTOR_OIDC_ISSUER=... quiltor run` still overrides
whatever is saved.
"""
from __future__ import annotations

import os
from pathlib import Path

import typer

from backend.llm.shared.platform import force_utf8_streams

force_utf8_streams()

app = typer.Typer(
    name="quiltor",
    help="Local-first writing workshop with a private, on-device assistant.",
    no_args_is_help=False,
    add_completion=False,
)
config_app = typer.Typer(help="Read or write persisted QUILTOR_* settings (~/.quiltor/config.env).")
app.add_typer(config_app, name="config")

CONFIG_PATH = Path.home() / ".quiltor" / "config.env"

# name -> short description, shown by `quiltor config list`/`get`/`set --help`.
KNOWN_KEYS: dict[str, str] = {
    "QUILTOR_OIDC_ISSUER": "Keycloak/OIDC realm issuer URL. Unset = local single-user mode.",
    "QUILTOR_OIDC_CLIENT_ID": "OIDC client ID.",
    "QUILTOR_OIDC_CLIENT_SECRET": "OIDC client secret.",
    "QUILTOR_PUBLIC_URL": "Public base URL Quiltor is reachable at (must match the OIDC redirect URI).",
    "QUILTOR_COOKIE_SECURE": "Session cookie Secure flag: auto (default), 0, or 1.",
    "QUILTOR_AI_URL": "External OpenAI-compatible inference endpoint. Unset = spawn the bundled local runtime.",
    "QUILTOR_AI_MODEL": "Path to a specific model file, overriding the bundled default.",
    "QUILTOR_AI_BINARY": "Path to a specific llama-server/MLX binary, overriding the bundled default.",
    "QUILTOR_AI_RUNTIME": "Force a specific local runtime: llamacpp or mlx.",
    "QUILTOR_AI_DEBUG": "Set to any value to enable verbose assistant-runtime logging.",
    "QUILTOR_DATA_DIR": "Directory for worlds, backups, and manuscripts data.",
    "QUILTOR_HOST": "Bind address for the server (default 127.0.0.1).",
}
SECRET_KEYS = {"QUILTOR_OIDC_CLIENT_SECRET"}


def _read_config() -> dict[str, str]:
    if not CONFIG_PATH.exists():
        return {}
    values: dict[str, str] = {}
    for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def _write_config(values: dict[str, str]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{key}={value}" for key, value in sorted(values.items())]
    CONFIG_PATH.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _load_config() -> None:
    """Apply the persisted config to the environment. Real env vars always win."""
    for key, value in _read_config().items():
        os.environ.setdefault(key, value)


def _mask(key: str, value: str) -> str:
    if key in SECRET_KEYS and value:
        return "*" * min(len(value), 8)
    return value


def _version() -> str:
    # Mirrors server.py's own BASE-relative VERSION lookup without importing
    # the (heavy, side-effectful-at-import-time) server module just for this.
    version_file = Path(__file__).resolve().parent.parent / "VERSION"
    return version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "dev"


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    version: bool = typer.Option(False, "--version", "-V", help="Show the Quiltor version and exit."),
) -> None:
    if version:
        typer.echo(_version())
        raise typer.Exit()
    if ctx.invoked_subcommand is None:
        _start_server(8000, False)


def _start_server(port: int, no_open: bool) -> None:
    _load_config()
    import server
    server.run(port=port, no_open=no_open)


@app.command()
def run(
    port: int = typer.Argument(8000, help="Port to listen on."),
    no_open: bool = typer.Option(False, "--no-open", help="Do not open a browser tab on startup."),
) -> None:
    """Start the server (same as `python3 server.py`)."""
    _start_server(port, no_open)


@config_app.command("list")
def config_list() -> None:
    """Show every persisted setting."""
    values = _read_config()
    if not values:
        typer.echo(f"No settings saved yet ({CONFIG_PATH}).")
        raise typer.Exit()
    for key, value in sorted(values.items()):
        typer.echo(f"{key}={_mask(key, value)}")


@config_app.command("path")
def config_path() -> None:
    """Print the path to the config file."""
    typer.echo(str(CONFIG_PATH))


@config_app.command("get")
def config_get(key: str) -> None:
    """Print one saved setting."""
    value = _read_config().get(key)
    if value is None:
        typer.echo(f"{key} is not set.", err=True)
        raise typer.Exit(code=1)
    typer.echo(_mask(key, value))


@config_app.command("set")
def config_set(key: str, value: str) -> None:
    """Save a QUILTOR_* setting, e.g. `quiltor config set QUILTOR_AI_URL http://host:11435`."""
    if key not in KNOWN_KEYS:
        typer.echo(f"Note: {key} isn't a setting Quiltor reads, saving it anyway.", err=True)
    values = _read_config()
    values[key] = value
    _write_config(values)
    typer.echo(f"Saved {key} to {CONFIG_PATH}.")


@config_app.command("unset")
def config_unset(key: str) -> None:
    """Remove a saved setting."""
    values = _read_config()
    if key not in values:
        typer.echo(f"{key} is not set.", err=True)
        raise typer.Exit(code=1)
    del values[key]
    _write_config(values)
    typer.echo(f"Removed {key}.")


@app.command()
def install() -> None:
    """Guided one-time setup: optional Keycloak multi-user login, optional local AI assistant."""
    _install_keycloak_step()
    typer.echo()
    _install_llm_step()


def _install_keycloak_step() -> None:
    current = _read_config()
    if not typer.confirm("Mehrbenutzer-Modus mit Keycloak-Login einrichten?", default=False):
        typer.echo("Übersprungen — Quiltor bleibt im lokalen Einzelnutzer-Modus.")
        return
    issuer = typer.prompt("Realm-Issuer-URL (QUILTOR_OIDC_ISSUER)", default=current.get("QUILTOR_OIDC_ISSUER", ""), show_default=False)
    client_id = typer.prompt("Client-ID (QUILTOR_OIDC_CLIENT_ID)", default=current.get("QUILTOR_OIDC_CLIENT_ID", ""), show_default=False)
    client_secret = typer.prompt(
        "Client-Secret (QUILTOR_OIDC_CLIENT_SECRET)",
        default=current.get("QUILTOR_OIDC_CLIENT_SECRET", ""),
        show_default=False,
        hide_input=True,
    )
    public_url = typer.prompt(
        "Öffentliche Basis-URL, z. B. https://quiltor.example.com (QUILTOR_PUBLIC_URL)",
        default=current.get("QUILTOR_PUBLIC_URL", ""),
        show_default=False,
    )
    cookie_secure = typer.prompt(
        "Cookie-Secure-Flag: auto/0/1 (QUILTOR_COOKIE_SECURE)",
        default=current.get("QUILTOR_COOKIE_SECURE", "auto"),
    )
    values = dict(current)
    values.update({
        "QUILTOR_OIDC_ISSUER": issuer.strip(),
        "QUILTOR_OIDC_CLIENT_ID": client_id.strip(),
        "QUILTOR_OIDC_CLIENT_SECRET": client_secret.strip(),
        "QUILTOR_PUBLIC_URL": public_url.strip(),
        "QUILTOR_COOKIE_SECURE": cookie_secure.strip(),
    })
    _write_config(values)
    typer.echo("Gespeichert — Keycloak-Login ist ab dem nächsten `quiltor run` aktiv.")


def _install_llm_step() -> None:
    if not typer.confirm("Lokalen KI-Assistenten einrichten (lädt Runtime + Modell herunter, ~2,5 GB)?", default=True):
        typer.echo(
            "Übersprungen. Extern anbindbar per `quiltor config set QUILTOR_AI_URL <url>`, "
            "oder später erneut mit `quiltor install`."
        )
        return
    from backend.llm.installer import install as install_llm, resolve_runtime
    runtime = resolve_runtime("auto")
    try:
        install_llm(runtime)
    except (SystemExit, Exception) as exc:
        # Also catches network/subprocess failures the installer surfaces as
        # SystemExit (e.g. an unsupported platform) -- see ensure_installed().
        typer.echo(f"! Einrichtung fehlgeschlagen: {exc}", err=True)
        typer.echo("Quiltor läuft trotzdem, nur ohne Assistenten. Erneut versuchen mit: quiltor install")


def main_entry() -> None:
    app()


if __name__ == "__main__":
    main_entry()
