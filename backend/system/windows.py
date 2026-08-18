"""Windows. See backend/system/contract.py for the surface.

Everything Windows-only (os.startfile, subprocess.CREATE_NO_WINDOW,
ctypes.windll) is touched inside function bodies, never at import time, so this
module imports cleanly on macOS and Linux and the contract test can check it
there.
"""

from __future__ import annotations

import functools
import os
import platform
import subprocess
from pathlib import Path

from backend.system.contract import APP_NAME

TRAY_SUPPORTS_BACKGROUND_THREAD = True


def data_home() -> Path:
    """The user profile root, not Roaming AppData: the model weights and runtime
    that land here are large and machine-local, and a roaming profile would try
    to sync them."""
    return Path.home() / APP_NAME


def reveal_in_file_manager(path: Path) -> None:
    os.startfile(str(path))  # local, trusted path only


def spawn_flags() -> int:
    """A console-less parent (the windowed desktop build) otherwise makes Windows
    pop up a terminal for every child. CREATE_NO_WINDOW is the documented fix;
    getattr keeps this module importable off Windows."""
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def bind_child_lifetime(process: object) -> None:
    """Make Windows kill `process` when we die.

    Unlike POSIX process groups, Windows does not kill children when their parent
    is force-terminated (task manager, a crash, an IDE hard-restart, taskkill /F)
    -- the child keeps running invisibly with the model loaded. That is how
    llama-server.exe instances accumulated across dev-server restarts. A Job
    Object with KILL_ON_JOB_CLOSE makes Windows enforce the lifetime itself,
    independent of whether our own cleanup ever runs.
    """
    import ctypes
    from ctypes import wintypes

    JobObjectExtendedLimitInformation = 9
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    PROCESS_TERMINATE = 0x0001
    PROCESS_SET_QUOTA = 0x0100

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_uint64)
            for name in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.windll.kernel32
    # `job` is deliberately never closed: KILL_ON_JOB_CLOSE fires when its LAST
    # handle closes, and this process's handle is that trigger. Windows closes it
    # for us on exit, graceful or not -- that is what ties the child to us.
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    kernel32.SetInformationJobObject(
        job, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
    )
    # This handle, unlike `job`, is only needed for the AssignProcessToJobObject
    # call below -- the association outlives it, so it must be closed here or it
    # leaks one handle per runtime launch.
    handle = kernel32.OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, False, process.pid)
    if handle:
        kernel32.AssignProcessToJobObject(job, handle)
        kernel32.CloseHandle(handle)


def executable_name(stem: str) -> str:
    return f"{stem}.exe"


def strip_quarantine(path: Path) -> None:
    """No-op: Windows uses Mark-of-the-Web, which does not block our own
    downloads the way macOS quarantine does."""


def is_apple_silicon() -> bool:
    return False


@functools.lru_cache(maxsize=1)
def in_os_app_package() -> bool:
    """True inside an MSIX package -- the Microsoft Store's delivery format.

    Cached: unlike the macOS side there is no environment variable behind this,
    so nothing can change it during the process, and backend/edition/ asks on
    every policy question.

    There is no environment variable for this the way macOS has one; the
    documented check is GetCurrentPackageFullName, which returns
    APPMODEL_ERROR_NO_PACKAGE for an unpackaged process and
    ERROR_INSUFFICIENT_BUFFER (we pass no buffer) for a packaged one.
    """
    APPMODEL_ERROR_NO_PACKAGE = 15700
    try:
        import ctypes
        from ctypes import wintypes

        length = wintypes.UINT(0)
        result = ctypes.windll.kernel32.GetCurrentPackageFullName(ctypes.byref(length), None)
        return result != APPMODEL_ERROR_NO_PACKAGE
    except Exception:
        # Pre-Windows-8, or the call is unavailable: an unpackaged build is the
        # safe assumption -- it only costs us the stricter Store code paths.
        return False


def os_name() -> str:
    return "windows"


def machine_arch() -> str:
    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
