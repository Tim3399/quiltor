"""Platform-specific runtime launchers. Each module here knows how to find and
start one concrete local LLM backend; all of them are expected to end up
serving the same OpenAI-compatible contract defined in backend/llm/shared.

This package's own __init__ holds the two bits every launcher needs and
would otherwise duplicate: resolving the port to listen on, and spawning a
subprocess with its output captured to a log file instead of discarded.
"""

from __future__ import annotations

import subprocess
import sys
import urllib.parse
from pathlib import Path


def resolve_port(url: str, default: int = 11435) -> int:
    return urllib.parse.urlsplit(url).port or default


def _bind_lifetime_to_parent(process: subprocess.Popen) -> None:
    """Make the OS kill `process` itself if this Python process ever dies.

    server.py's `finally: ASSISTANT.close()` only runs on a graceful exit
    (Ctrl+C, normal return). Unlike POSIX process groups, Windows does not
    kill children when their parent is force-terminated (task manager, a
    crash, an IDE hard-restart, `taskkill /F`) -- the child just keeps
    running, invisibly, with the model loaded. That's how llama-server.exe
    instances accumulated across dev-server restarts. A Job Object with
    KILL_ON_JOB_CLOSE makes Windows enforce the child's lifetime itself,
    independent of whether our own cleanup code ever gets to run.
    """
    if sys.platform != "win32":
        return
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
        _fields_ = [(name, ctypes.c_uint64) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

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
    # `job` is deliberately never closed: KILL_ON_JOB_CLOSE fires when its LAST handle
    # closes, and this process's handle is that trigger. Windows closes it for us on
    # exit (graceful or not) -- that's what ties the child's lifetime to ours.
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    kernel32.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info))
    # This handle, unlike `job`, is only needed for the AssignProcessToJobObject call
    # below -- the job/process association outlives it, so it must be closed here or
    # it leaks one handle per runtime launch.
    handle = kernel32.OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, False, process.pid)
    if handle:
        kernel32.AssignProcessToJobObject(job, handle)
        kernel32.CloseHandle(handle)


def spawn_logged(argv: list[str], data: Path, log_name: str) -> tuple[subprocess.Popen[str], Path]:
    """Spawn argv with stdout/stderr captured to data/log_name. Returns the process and the log path."""
    log_path = data / log_name
    log = open(log_path, "a", encoding="utf-8")
    process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, text=True)
    _bind_lifetime_to_parent(process)
    return process, log_path
