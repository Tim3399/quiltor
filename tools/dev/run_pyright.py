"""Run the npm-pinned pyright against the interpreter that launched this script.

pyright resolves third-party imports through a Python interpreter. Left alone it picks a
bare `python` from PATH, which CLAUDE.md warns may be one without the project's
dependencies. `tools/dev/python.mjs --needs typer` chooses an interpreter that has them
and starts this script with it; this script hands that exact interpreter to pyright.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENTRY = ROOT / "node_modules" / "pyright" / "index.js"


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print("node not found on PATH", file=sys.stderr)
        return 1
    if not ENTRY.is_file():
        print(f"pyright not installed at {ENTRY}; run `npm ci`", file=sys.stderr)
        return 1
    command = [node, str(ENTRY), "--pythonpath", sys.executable, *sys.argv[1:]]
    return subprocess.call(command, cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main())
