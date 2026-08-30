# Hosts, platform adapters and distribution

Status: **proposed target view**

Answers: **How do web, desktop, mobile and headless hosts compose the same
product, and how do installers/stores stay outside runtime product logic?**

Host, platform, distribution, release channel and entitlement are independent
axes. A Windows desktop host can be distributed directly or through Microsoft
Store without creating two product implementations. This view is a reference
composition; the binding principles and rollout gates are fixed in the
implementation plan.

## Runtime host composition

UI hosts inject one immutable `RuntimeDependencies` object into the shared
client. Its `ApplicationGateway` is a namespaced grouping of context-specific
ports, not a global facade or command bus. Headless hosts invoke the same focused
application ports without mounting React.

```mermaid
flowchart LR
    subgraph Hosts["Executable hosts"]
        WebHost["WebHost"]
        DesktopHost["DesktopHost"]
        MobileHost["MobileHost"]
        CliHost["CliHost"]
        McpHost["McpHost"]
    end

    subgraph Client["Shared client boundary"]
        RuntimeDependencies["RuntimeDependencies"]
        ApplicationGateway(("ApplicationGateway"))
        PlatformGateway(("PlatformGateway"))
    end

    subgraph ApplicationAdapters["Versioned application adapters"]
        HttpClient["HttpApplicationAdapter"]
        NativeAppClient["NativeApplicationBridgeClient"]
        HttpIngress["Context-specific HTTP controllers"]
        NativeAppBridge["Native Application Bridge"]
        ApplicationPorts["Manuscript · Story World · Catalog · Assistant ports"]
    end

    subgraph PlatformAdapters["Device capability adapters"]
        BrowserAdapter["BrowserPlatformAdapter"]
        NativePlatformClient["NativePlatformBridgeClient"]
        NativePlatformBridge["Native Platform Bridge"]
        OsAdapters["Windows · macOS · Linux · iOS · Android adapters"]
    end

    WebHost --> RuntimeDependencies
    DesktopHost --> RuntimeDependencies
    MobileHost --> RuntimeDependencies
    RuntimeDependencies --> ApplicationGateway
    RuntimeDependencies --> PlatformGateway
    HttpClient -.->|"implements"| ApplicationGateway
    NativeAppClient -.->|"implements"| ApplicationGateway
    BrowserAdapter -.->|"implements"| PlatformGateway
    NativePlatformClient -.->|"implements"| PlatformGateway
    HttpClient --> HttpIngress
    NativeAppClient --> NativeAppBridge
    HttpIngress --> ApplicationPorts
    NativeAppBridge --> ApplicationPorts
    NativePlatformClient --> NativePlatformBridge
    NativePlatformBridge --> OsAdapters
    CliHost --> ApplicationPorts
    McpHost --> ApplicationPorts
```

The two native bridges are intentionally unrelated:

- **Native Application Bridge** transports versioned, context-specific product
  operations;
- **Native Platform Bridge** exposes device capabilities such as documents,
  authentication, sharing and lifecycle.

No product request contains a Windows path, Apple bookmark or Android URI. A
temporary document handle may cross a platform-import workflow; canonical world
state stores only a project-owned `WorldAssetId`.

## Focused platform ports

```mermaid
classDiagram
direction TB

class PlatformGateway
class AppDirectoriesPort {
  <<interface>>
}
class DocumentAccessPort {
  <<interface>>
}
class CredentialVault {
  <<interface>>
}
class ExternalAuthenticationPort {
  <<interface>>
}
class ClipboardSharePort {
  <<interface>>
}
class LifecycleSchedulerPort {
  <<interface>>
}
class ProcessSupervisorPort {
  <<interface>>
}
class HardwareProfilePort {
  <<interface>>
}
class DiagnosticsPort {
  <<interface>>
}

PlatformGateway *-- AppDirectoriesPort
PlatformGateway *-- DocumentAccessPort
PlatformGateway *-- CredentialVault
PlatformGateway *-- ExternalAuthenticationPort
PlatformGateway *-- ClipboardSharePort
PlatformGateway *-- LifecycleSchedulerPort
PlatformGateway *-- ProcessSupervisorPort
PlatformGateway *-- HardwareProfilePort
PlatformGateway *-- DiagnosticsPort
```

Hosts provide only supported capabilities:

| Platform adapter | Typical implementations                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser          | origin storage/preferences, browser clipboard/navigation, File System Access or download fallback; no process supervisor                                                |
| Windows          | known folders, Win32 document picker, Credential Manager, protocol activation, sharing, process supervision, GPU/RAM probe                                              |
| macOS            | Application Support/cache locations, security-scoped bookmarks, Keychain, ASWebAuthenticationSession, share services, process/hardware probe where distribution permits |
| Linux            | XDG directories, portal document handles, Secret Service, URI activation, process supervision and hardware probe                                                        |
| iOS              | app-group/container directories, security-scoped document handles, Keychain, AuthenticationServices, share sheet and lifecycle scheduling; no arbitrary child process   |
| Android          | app storage, persisted Storage Access Framework URI, Keystore, Custom Tabs, Sharesheet and WorkManager/lifecycle; no desktop process model                              |

Desktop window, tray and menu classes stay inside their desktop host and are not
added to `PlatformGateway` unless product code genuinely consumes the
capability.

## Runtime capability calculation

```mermaid
flowchart LR
    HostCapability["HostCapability"] --> Resolver["EffectiveCapabilityResolver"]
    PlatformCapability["PlatformCapability"] --> Resolver
    DistributionConstraint["DistributionConstraint"] --> Resolver
    Entitlement["Entitlement"] --> Resolver
    HardwareProfile["HardwareProfile"] --> Resolver
    Resolver --> EffectiveCapabilities["EffectiveCapabilities"]
    EffectiveCapabilities --> ProductModule["Product module"]
```

Product modules receive the result, not the axes. Inference execution may use
the hardware portion through its dedicated port, but provider registries and a
model control plane are introduced only when product triggers require them.

## Runtime and storage ownership

Each artifact embeds one coherent application/storage implementation profile.
A host may select an HTTP adapter or Native Application Bridge, but it never
chooses Python for one write and Rust for another.

```mermaid
flowchart LR
    Host["Host bootstrap"] --> Profile{"RuntimeProfile"}
    Profile -->|"current desktop/web"| Current["Application runtime + one SQLite owner"]
    Profile -->|"future measured native cutover"| Native["Native runtime + one SQLite owner"]
    Current --> Contracts["Versioned application contracts"]
    Native --> Contracts
    Contracts --> Gateway["Context-specific ApplicationGateway"]
```

Pure deterministic policies may migrate behind focused Rust ports earlier,
provided shared contract fixtures exist. SQLite persistence does not migrate
operation by operation. A full native storage cutover is gated by a concrete
mobile/native milestone, simulator tests and performance measurements; until
then the existing storage owner remains authoritative.

## Build and publishing model

Build-time classes do not appear in the runtime host diagram. `TargetProfile` is
the typed source input; `RuntimeProfile` is the immutable subset embedded in an
artifact.

```mermaid
classDiagram
direction LR

class TargetProfile {
  <<buildInput>>
  +HostTarget host
  +PlatformTarget platform
  +DistributionTarget distribution
  +ReleaseChannel channel
}
class BuildOrchestrator
class ArtifactBuilder {
  <<interface>>
}
class ArtifactSigner {
  <<interface>>
}
class RuntimeProfile {
  <<embeddedRuntimeData>>
}
class Artifact
class PublisherAdapter {
  <<interface>>
}
class ReleaseManifest
class ContractAndSmokeSuite

TargetProfile --> BuildOrchestrator
BuildOrchestrator --> ArtifactBuilder
BuildOrchestrator --> ArtifactSigner
BuildOrchestrator --> RuntimeProfile : derives and embeds
ArtifactBuilder --> Artifact
Artifact *-- RuntimeProfile
BuildOrchestrator --> ContractAndSmokeSuite
ContractAndSmokeSuite --> Artifact : verifies
BuildOrchestrator --> ReleaseManifest
ReleaseManifest --> PublisherAdapter
PublisherAdapter --> Artifact : publishes
```

### Artifact builders

| Builder adapter                 | Output                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `WebArtifactBuilder`            | static client plus server/container assets                      |
| `WindowsInstallerBuilder`       | signed MSIX/MSI/installer for direct Windows distribution       |
| `MacInstallerBuilder`           | signed/notarised app plus DMG/PKG for direct macOS distribution |
| `LinuxPackageBuilder`           | AppImage/deb/rpm/portable archive as selected by profile        |
| `AppleStoreArtifactBuilder`     | App Store/TestFlight-compliant macOS or iOS archive             |
| `GooglePlayArtifactBuilder`     | Android App Bundle for Play tracks                              |
| `MicrosoftStoreArtifactBuilder` | Store-compliant MSIX package                                    |
| `PythonPackageBuilder`          | wheel/sdist for PyPI when the profile allows it                 |
| `ContainerArtifactBuilder`      | OCI image                                                       |

### Publisher adapters

`AppleAppStorePublisher`, `GooglePlayPublisher`,
`MicrosoftStorePublisher`, `DirectDownloadPublisher`, `GitHubPublisher`,
`PyPIPublisher` and `OciPublisher` implement `PublisherAdapter`. Publisher SDKs,
credentials, signing and store metadata remain under `distribution/` and CI;
they are never linked into product modules.

## Build-to-runtime handoff

```mermaid
sequenceDiagram
    participant Profile as TargetProfile
    participant Build as BuildOrchestrator
    participant Test as ContractAndSmokeSuite
    participant Artifact as Signed Artifact
    participant Host as Host Bootstrap

    Profile->>Build: immutable build input
    Build->>Build: compile + package + sign
    Build->>Artifact: embed RuntimeProfile
    Build->>Test: verify artifact and contracts
    Test-->>Build: pass
    Build-->>Artifact: publish through selected adapter
    Host->>Artifact: read embedded RuntimeProfile
    Host->>Host: validate OS/device facts
    Host->>Host: construct RuntimeDependencies
```

Runtime OS detection may validate a profile and probe capabilities. It may not
guess whether the artifact came from Apple, Google, Microsoft or a direct
download.

## Current code to target responsibility

| Current code/concept                                       | Target responsibility                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/main.tsx`                                        | `WebHost` composition root                                                |
| packaged HTTP/desktop/CLI/MCP entrypoints                  | explicit host composition roots                                           |
| `QuiltorClient` object plus mutable configuration function | injected immutable `RuntimeDependencies`                                  |
| current namespaced application gateways                    | retained context-specific `ApplicationGateway` shape                      |
| current application HTTP gateways                          | `HttpApplicationAdapter`                                                  |
| Native Bridge v1 `file.save`                               | Native Platform Bridge file import; canonical storage uses `WorldAssetId` |
| generic application routing                                | versioned controllers/bridge calls mapped directly to focused use cases   |
| build profile JSON                                         | typed source `TargetProfile`                                              |
| runtime profile facts                                      | embedded immutable `RuntimeProfile`, including one persistence owner      |
| platform/store names in conditionals                       | platform, artifact-builder or publisher adapters                          |

Adding a target is additive: profile, missing adapters, builder/signing,
publisher metadata and target tests. It does not branch Manuscript, Story World,
Timeline or Assistant product logic.
