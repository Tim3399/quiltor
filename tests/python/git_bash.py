"""The bash the workflow-script tests run under."""

import os
import shutil
from pathlib import Path


def find_bash():
    """
    Git for Windows' bash.exe on Windows, the bash on PATH elsewhere; None when there is none.

    On Windows the first bash on PATH can be System32's, which is WSL. WSL reads `C:/...` as a
    relative path -- it once left a `C<U+F03A>` folder in the repository root -- keeps the
    temporary directory open so it cannot be removed (WinError 32), and passes no environment
    on. A test that gets None skips instead of failing for the wrong reason.

    Git's own bash lies next to git: Git\\cmd\\git.exe, or Git\\mingw64\\bin\\git.exe when
    started from Git Bash.
    """

    if os.name != "nt":
        return shutil.which("bash")
    git = shutil.which("git")
    parents = list(Path(git).resolve().parents)[1:3] if git else []
    candidates = [parent / "bin" / "bash.exe" for parent in parents]
    return next((str(path) for path in candidates if path.exists()), None)
