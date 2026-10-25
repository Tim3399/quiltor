"""Load a Python file as a module, for code the tests may not import by package name.

The reference services under services/ are deliberately independent of the product
package, so tests import them by path. The result is typed `Any`: the tests reassign the
module's configuration constants after import, which a plain ModuleType does not declare.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


def load_module_from_path(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path} as module {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
