# Native bridge

Native hosts expose a versioned request/response bridge to the shared client.
The bridge provides application operations and platform capabilities without
publishing arbitrary host objects to JavaScript.

Every public operation appears in the schema, enforces bounded payloads and
returns a structured verdict. Native objects, filesystem paths and exception
tracebacks never cross the boundary directly.

Version 1 exposes `file.save`. Its payload carries a safe suggested file name
and base64 bytes. The successful result is either `saved` or `cancelled`;
failures use the shared structured-error contract. The response echoes every
valid request ID, including validation, version and operation errors.
