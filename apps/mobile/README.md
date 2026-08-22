# Quiltor mobile hosts

iOS and Android are native hosts for the shared Quiltor client. They are not
variants of the Python/pywebview desktop host.

Both hosts must:

- load the shared React client;
- implement the versioned native bridge;
- bind the portable local core;
- use native document, credential, authentication and lifecycle APIs;
- keep application data local and migrate it through the shared storage
  contract;
- advertise unavailable capabilities rather than rendering controls that fail.

Framework-specific projects are added only together with simulator/device CI.
An empty Xcode or Gradle project that no workflow builds is not considered a
mobile implementation.
