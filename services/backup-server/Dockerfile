# Quiltor backup endpoint.
#
# A plain Python base, unlike the app image: this server is standard library
# only (see server.py's module docstring), so there is nothing to install and
# nothing to build. If this file ever grows a `pip install`, the server has
# gained a dependency it was not supposed to have.
ARG BACKUP_BASE_IMAGE=python:3.12.13-slim-trixie@sha256:646fb0bca3dd3ea1bcc6feb72c17ed16eed6e10cffc732fcc1478bd3e7f02d7b
FROM ${BACKUP_BASE_IMAGE}

ARG BACKUP_BASE_IMAGE
RUN test "$BACKUP_BASE_IMAGE" = \
    "python:3.12.13-slim-trixie@sha256:646fb0bca3dd3ea1bcc6feb72c17ed16eed6e10cffc732fcc1478bd3e7f02d7b"

ARG QUILTOR_VERSION=dev
ARG QUILTOR_REVISION=unknown

ENV PYTHONDONTWRITEBYTECODE=1
# Unbuffered for the same reason as the app image: a pipe makes Python hold
# stdout back until 8 KB have accumulated, which turns `docker logs` into a
# record that arrives long after the moment anyone wanted to see.
ENV PYTHONUNBUFFERED=1

RUN useradd --create-home --shell /usr/sbin/nologin quiltor

WORKDIR /app
COPY services/backup-server/server.py ./
# The service and application restore path execute this exact shared manifest
# contract.  Copy only the stdlib-only contract module; namespace packages keep
# the backup image independent of the rest of the application runtime.
COPY src/quiltor/application/backup_manifest.py ./quiltor/application/backup_manifest.py
COPY services/backup-server/artifact-contract.json ./quiltor-backup-service.json
COPY VERSION LICENSE THIRD-PARTY-NOTICES.md ./
RUN python3 -c "import json,pathlib,re; p=json.load(open('quiltor-backup-service.json')); files={str(x.relative_to('/app')).replace('\\\\','/') for x in pathlib.Path('/app').rglob('*') if x.is_file()}; assert p['schemaVersion']==1 and p['contractVersion']==1; assert p['id']=='quiltor-backup-service' and p['role']=='backup-service'; assert files==set(p['payload']); assert re.fullmatch(r'[0-9]+\\.[0-9]+\\.[0-9]+', pathlib.Path(p['versionSource']).read_text().strip())"

LABEL org.opencontainers.image.source="https://github.com/Tim3399/quiltor" \
      org.opencontainers.image.version="${QUILTOR_VERSION}" \
      org.opencontainers.image.revision="${QUILTOR_REVISION}" \
      org.quiltor.role="backup-service"

# Where the blobs and manifests live. Owned by the runtime user *before* VOLUME
# is declared, since Docker seeds a fresh volume's ownership from whatever is at
# that path in the image.
ENV QUILTOR_BACKUP_ROOT=/data
RUN mkdir -p /data && chown -R quiltor:quiltor /app /data

# This container holds whole manuscripts and talks to Keycloak with a client
# secret; it has no business running as root.
USER quiltor

VOLUME ["/data"]
EXPOSE 9000

# --host 0.0.0.0 for the same reason the app image does it: a container's
# loopback interface is not reachable through Docker's port forwarding, so
# binding it would publish nothing. What restricts access is the reverse proxy
# in front, plus the endpoint's own token check -- it refuses to start without
# its Keycloak configuration, so there is no unprotected state to expose.
CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "9000"]
