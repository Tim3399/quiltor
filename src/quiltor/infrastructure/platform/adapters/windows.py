"""Windows host primitives. Importable on every operating system."""

from __future__ import annotations

import functools
import os
import platform
import subprocess
import tempfile
from pathlib import Path

from quiltor.infrastructure.platform.constants import APP_NAME
from quiltor.infrastructure.platform.ports import AppDirectories

TRAY_SUPPORTS_BACKGROUND_THREAD = True


def app_directories() -> AppDirectories:
    root = Path.home() / APP_NAME
    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / APP_NAME
    return AppDirectories(
        data=root / "data",
        config=local / "config",
        cache=local / "cache",
        models=root / "models",
        logs=local / "logs",
        temp=Path(tempfile.gettempdir()) / APP_NAME,
    )


def reveal_in_file_manager(path: Path) -> None:
    os.startfile(str(path))


def spawn_flags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def bind_child_lifetime(process: object) -> None:
    """Bind a child to a Windows Job Object with KILL_ON_JOB_CLOSE."""
    import ctypes
    from ctypes import wintypes

    job_object_extended_limit_information = 9
    kill_on_job_close = 0x00002000
    process_terminate = 0x0001
    process_set_quota = 0x0100

    class BasicLimitInformation(ctypes.Structure):
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

    class IoCounters(ctypes.Structure):
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

    class ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimitInformation),
            ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.windll.kernel32
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return
    info = ExtendedLimitInformation()
    info.BasicLimitInformation.LimitFlags = kill_on_job_close
    kernel32.SetInformationJobObject(
        job,
        job_object_extended_limit_information,
        ctypes.byref(info),
        ctypes.sizeof(info),
    )
    handle = kernel32.OpenProcess(process_terminate | process_set_quota, False, process.pid)
    if handle:
        kernel32.AssignProcessToJobObject(job, handle)
        kernel32.CloseHandle(handle)


def executable_name(stem: str) -> str:
    return f"{stem}.exe"


def strip_quarantine(path: Path) -> None:
    return None


def is_apple_silicon() -> bool:
    return False


@functools.lru_cache(maxsize=1)
def in_os_app_package() -> bool:
    appmodel_error_no_package = 15700
    try:
        import ctypes
        from ctypes import wintypes

        length = wintypes.UINT(0)
        result = ctypes.windll.kernel32.GetCurrentPackageFullName(ctypes.byref(length), None)
        return result != appmodel_error_no_package
    except Exception:
        return False


def os_name() -> str:
    return "windows"


def machine_arch() -> str:
    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
