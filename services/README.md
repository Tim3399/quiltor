# Independently deployable services

Only processes with their own deployment lifecycle belong here. Product modules,
desktop/mobile hosts and packaging scripts do not. Each service owns its build
context, runtime documentation and health contract.

- `backup-server/` is the optional authenticated remote-backup endpoint. It can
  run without the Quiltor web application and is released as a separate image.
