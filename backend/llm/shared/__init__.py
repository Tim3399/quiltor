"""Platform-agnostic pieces of the local LLM contract: the HTTP client and the
JSON-schema response-format helper. Nothing in this package knows or cares
which backend (llama.cpp, MLX, a remote endpoint) is actually serving requests.
"""
