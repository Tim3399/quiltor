# Quiltor backup server

The reference remote-backup endpoint is a dependency-free Python service with an
independent container and data volume. It requires OIDC configuration and refuses
to start without authentication; see `.env.example` and the `with-backup` profile
in `docker-compose.yml`.

Run from a source checkout:

```bash
python services/backup-server/server.py --port 9000
```

Build only this service from the repository root. The root context is required
because the image embeds the shared manifest contract and legal documents:

```bash
python distribution/tooling/container_contract.py check
docker build --file services/backup-server/Dockerfile --tag quiltor-backup .
```
