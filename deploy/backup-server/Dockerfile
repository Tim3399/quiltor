# Quiltor backup endpoint.
#
# A plain Python base, unlike the app image: this server is standard library
# only (see server.py's module docstring), so there is nothing to install and
# nothing to build. If this file ever grows a `pip install`, the server has
# gained a dependency it was not supposed to have.
FROM python:3.12-slim

RUN useradd --create-home --shell /usr/sbin/nologin quiltor

WORKDIR /app
COPY server.py ./

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
