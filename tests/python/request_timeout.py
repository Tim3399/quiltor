"""How long a test waits for an answer from the built-in server.

Five seconds were too tight. On a loaded Windows runner, creating a world -- SQLite file,
directories, syncing to disk -- took longer, and the test failed with a socket timeout even
though nothing had hung. Afterwards the temp directory could no longer be cleared, because
the server still held the file open: one slow run turned into two failures.

Twenty seconds were then too tight as well. In CI 42850981291 (Windows Core) two world
creations took 25.0 s and 23.2 s, a minute apart, while the run's other 258 took 63 ms in
the median and 2 s at the 99th percentile. Nothing in the server waited on anything: the
route holds only the application lock, and nothing else ran in that test's server. The
same two tests pass locally under six-fold load on both the branch and its base, with at
most 1.6 s per creation (dev/D-T-61-6-F2.md).

Sixty seconds still turn a real hang into a failure instead of a stuck run, and a test that
answers in time is not a second slower. They stand here in one place so that not every
suite invents its own patience.
"""

REQUEST_TIMEOUT = 60
