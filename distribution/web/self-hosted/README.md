# Self-hosted web target

Status: **supported**. The repository `Dockerfile` is the build entrypoint and
the digest-bound image is the publication artifact. Release builds use only a
unique run/attempt/SHA hand-off tag; the authorized publish workflow promotes
the verified digest to the public version and `latest` tags together. Deployment-specific
configuration stays outside the image. Reverse-proxy examples live in `proxy/`;
the independently deployable backup endpoint lives under `services/backup-server/`.
