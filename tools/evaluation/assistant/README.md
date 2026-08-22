# Local assistant evaluation

This directory owns developer-only, real-model evaluation. It is not imported
or shipped by Quiltor.

- `run_local_stack.py` starts an isolated application and llama.cpp runtime.
- `run_scenarios.py` exercises the durable assistant-job API and writes reports.
- `seed_synthetic_world.py` creates the focused product scenario.
- `seed_public_domain_world.py` creates the long-context public-domain scenario.
- `fixtures/` contains evaluation-only source material.

Run the default local suite from the repository root with
`npm run test:assistant:local`. Model and runtime payloads remain outside source
control under `models/` and `runtime/`.
