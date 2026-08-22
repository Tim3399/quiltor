#!/usr/bin/env python3
"""Run the web host directly from a source checkout."""

from __future__ import annotations

import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = REPOSITORY_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from quiltor import resources  # noqa: E402
from quiltor.bootstrap.web import build_web_application  # noqa: E402
from quiltor.hosts.web.server import main  # noqa: E402
from quiltor.infrastructure.pdf import server_renderer  # noqa: E402


if __name__ == "__main__":
    main(
        application=build_web_application(
            render_pdf=server_renderer(
                resources.sidecar_asset("pdf/render-book-pdf.mjs"),
                REPOSITORY_ROOT,
            )
        )
    )
