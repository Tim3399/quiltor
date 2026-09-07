"""How long a test waits for an answer from the built-in server.

Five seconds were too tight. On a loaded Windows runner, creating a world -- SQLite file,
directories, syncing to disk -- took longer, and the test failed with a socket timeout even
though nothing had hung. Afterwards the temp directory could no longer be cleared, because
the server still held the file open: one slow run turned into two failures.

Twenty seconds do not deny a real hang its chance to be noticed -- the run still aborts
instead of waiting until the job has spent its time. They stand here in one place so that
not every suite invents its own patience; twenty was already the measure in
``test_backup_routes``, the only one that never failed at this limit.
"""

REQUEST_TIMEOUT = 20
