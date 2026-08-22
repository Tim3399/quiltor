# Architecture boundaries

## Host, platform, distribution and entitlement

| Boundary        | Answers                                       | Examples                                            |
| --------------- | --------------------------------------------- | --------------------------------------------------- |
| Host            | How is the product started and invoked?       | browser, desktop, mobile, CLI, MCP                  |
| Platform        | Which device/OS facilities exist?             | Windows, macOS, iOS, Android                        |
| Distribution    | Which rules apply to this artifact?           | direct, Mac App Store, Microsoft Store, Google Play |
| Release channel | How does this build reach testers/users?      | stable, beta, TestFlight, Play internal             |
| Entitlement     | What has this user purchased or been granted? | direct licence, StoreKit, Play Billing              |

Store presence is not a product entitlement. Sandboxing is not proof of store
origin. An operating system is not a distribution channel.

## Cross-runtime contracts

The following boundaries are versioned and tested with shared fixtures:

- HTTP application API;
- native client bridge;
- MCP tool schemas;
- backup protocol;
- document and story-world payloads;
- SQLite schema migrations;
- build profile manifest;
- structured error codes.

TypeScript, Python and the portable core consume the same fixtures. Equivalent
code in several languages without shared fixtures is not an accepted contract.

## Persistence and files

Application data does not depend on a single `data_home` path. Adapters expose
separate locations for databases, configuration, caches, models, logs,
temporary data and files excluded from device backup.

User-selected files are represented by opaque document handles. A handle may be
a normal path on desktop, a security-scoped bookmark on Apple platforms or a
persisted Storage Access Framework URI on Android.

Credentials never share ordinary settings storage. They are kept behind a
credential-vault port.

## Distribution and commerce

Distribution constraints describe facts such as sandboxing, executable
downloads, child processes and update ownership. Commerce verifies receipts and
licences. Their adapters and tests stay separate.

Effective feature availability is computed by the application shell from:

```text
host capabilities
∩ platform capabilities
∩ distribution constraints
∩ user entitlements
```

Product modules receive the resulting capability, not the factors used to
derive it.

## Imports enforced by checks

- Product domain modules must not import transport, platform or distribution
  implementations.
- Platform adapters must not import UI modules.
- Frontend modules must not import another module's private UI.
- UI localisation must not be imported by domain models.
- Store SDKs may only be imported by commerce/distribution adapters.
- OS branching and native browser globals are confined to registered adapters.
