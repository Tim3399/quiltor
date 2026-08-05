"""The ``quiltor`` command -- one entry point to set up and run the app.

Deliberately thin: it wraps the pieces that already exist (server.main, the
model installer, the runtime health check) so a non-developer never has to know
about ports, modules or model files. Model *choice* is not exposed -- a user
takes the pre-selected model or points QUILTOR_AI_URL / QUILTOR_EMBED_URL at
their own endpoint.
"""

from __future__ import annotations

import argparse
import sys

from backend import paths
from backend.llm.shared.contract import check_health


def _doctor() -> int:
    from backend.llm import installer

    print("Quiltor doctor")
    print(f"  home         {paths.home()}")
    print(f"  data         {paths.data_dir()}")
    print(f"  runtime      {paths.runtime_dir()}  ({'present' if (paths.runtime_dir() / installer.llamacpp.binary_name()).exists() else 'missing'})")
    generation = sorted(paths.models_dir().glob('*.gguf'))
    embedding = sorted((paths.models_dir() / 'embed').glob('*.gguf'))
    print(f"  gen model    {generation[0].name if generation else 'missing — run: quiltor install'}")
    print(f"  embed model  {embedding[0].name if embedding else 'missing — run: quiltor install --with-embeddings (optional)'}")
    import os
    ai_url = os.environ.get("QUILTOR_AI_URL")
    print(f"  ai endpoint  {ai_url or 'local (bundled)'}  ({'reachable' if check_health(ai_url or 'http://127.0.0.1:11435') else 'not running'})")
    ok = bool(generation) or bool(ai_url)
    print("  status       " + ("ready" if ok else "not set up — run: quiltor install"))
    return 0 if ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="quiltor", description="Quiltor — local writing workshop")
    sub = parser.add_subparsers(dest="command")

    run_parser = sub.add_parser("run", help="start the server (this is the default)")
    run_parser.add_argument("port", nargs="?", type=int, default=8000)
    run_parser.add_argument("--no-open", action="store_true", help="do not open a browser")

    install_parser = sub.add_parser("install", help="download the local model runtime and models")
    install_parser.add_argument("--runtime", choices=["auto", "llamacpp", "mlx"], default="auto")
    install_parser.add_argument("--with-embeddings", action="store_true", help="also install the embedding model for semantic retrieval")
    install_parser.add_argument("--skip-runtime", action="store_true")
    install_parser.add_argument("--skip-model", action="store_true")

    sub.add_parser("doctor", help="check the installation and connectivity")

    args = parser.parse_args()
    command = args.command or "run"

    if command == "install":
        from backend.llm import installer

        runtime = installer.resolve_runtime(args.runtime)
        print(f"Runtime: {runtime}")
        installer.install(runtime, skip_runtime=args.skip_runtime, skip_model=args.skip_model)
        if args.with_embeddings:
            installer.install_embedding_model()
        print("\nDone. Start Quiltor with: quiltor")
    elif command == "doctor":
        sys.exit(_doctor())
    else:
        import server

        server.main([str(args.port), *(["--no-open"] if args.no_open else [])])


if __name__ == "__main__":
    main()
