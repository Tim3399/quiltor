# Bundled inference runtime

Platform release jobs place the matching `llama-server` executable here. Quiltor starts it on loopback port 11435 and terminates the child process when the application server stops. No model endpoint is exposed beyond the local machine.

During development, `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL`, or `QUILTOR_AI_URL` can point at an existing local runtime.
