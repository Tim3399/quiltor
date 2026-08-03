"""Local LLM runtime layer: a platform-agnostic contract plus per-platform launchers.

backend/llm/shared/    -- everything that talks to a runtime over HTTP, independent
                          of which backend is actually running (llama.cpp, MLX, a
                          remote endpoint). This is the only part backend/assistant.py
                          depends on for actually invoking the model.
backend/llm/runtimes/  -- platform-specific launchers that know how to find and start
                          a concrete backend (currently llama.cpp everywhere; a macOS
                          MLX backend is planned as a sibling module here).
backend/llm/select.py  -- picks and starts the right runtime for the current platform,
                          honouring the QUILTOR_AI_* environment overrides.
"""
