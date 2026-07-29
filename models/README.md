# Bundled local model

Quiltor release packages place one GGUF model in this directory. The initial release target is `Qwen3-4B-Q4_K_M.gguf`: it is multilingual, supports agentic structured output, and the official weights and GGUF distribution use the Apache-2.0 license.

The model boundary is editorial rather than consumer-oriented: lawful fictional violence, sex, crime, horror, abuse, politics, religion, and other difficult material must remain analysable. Before a model is shipped, it must pass Quiltor's refusal evaluation. Community “uncensored” derivatives are not shipped without separate provenance and commercial-license review.

The file is deliberately excluded from Git because release assets, not source control, own multi-gigabyte model payloads. `QUILTOR_AI_MODEL` can select another local GGUF without changing the application.
