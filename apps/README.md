# Application shells

`apps/` owns repository-level shells and native project roots. These are the
places where a host is assembled from the shared client and the packaged
Quiltor runtime:

- `web/` is the source-checkout web shell and Vite entrypoint;
- `mobile/ios/` and `mobile/android/` are the reserved native project roots and
  define the contracts a future Xcode or Gradle project must implement.

Python entrypoints that must be importable from a wheel live under
`src/quiltor/hosts/` instead. That package owns the executable CLI, desktop,
MCP, and HTTP runtime composition roots. An `apps/` shell may call one of those
packaged hosts, but product modules never import either location.

Store and installer concerns do not belong here. Their build profiles, signing
configuration, metadata, and publishing workflows live under `distribution/`.
