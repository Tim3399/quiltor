"""Minimal CLI entry point for `pip install quiltor`.

Wraps server.py's existing argv-based startup (port + --no-open) unchanged.
"""
from __future__ import annotations


def main() -> None:
    import server
    server.main()


if __name__ == "__main__":
    main()
