# Application, identity and persistence

Status: **proposed target view**

Answers: **How does a transport-neutral request reach a focused use case, and
what is committed atomically?**

The boundaries and invariants in this view are normative. Class names and the
exact decomposition are a reference for migration and may be refined by code
feedback. Quiltor uses context-specific application ports and use cases; it does
not introduce a global `ApplicationFacade`, generic command bus or service
locator.

## Delivery and application boundaries

```mermaid
classDiagram
direction LR

class ManuscriptController
class StoryWorldController
class WorldCatalogController
class AssistantController

class RequestContext {
  +Principal principal
  +CorrelationId correlationId
}

class ManuscriptApplicationPort {
  <<interface>>
  +loadChapter(RequestContext, ChapterId) ChapterView
  +saveChapter(RequestContext, SaveChapterRequest) SaveResult
}
class StoryWorldApplicationPort {
  <<interface>>
  +loadWorld(RequestContext, WorldId) StoryWorldView
  +applyMutation(RequestContext, StoryWorldMutation) MutationResult
}
class WorldCatalogApplicationPort {
  <<interface>>
  +listWorlds(RequestContext) WorldSummary[]
  +openWorld(RequestContext, WorldId) WorldDescriptor
}
class AssistantApplicationPort {
  <<interface>>
  +respond(RequestContext, AssistantRequest) AssistantReply
  +acceptProposal(RequestContext, AcceptProposalRequest) CommitResult
}

class SaveChapterUseCase
class ApplyStoryWorldMutationUseCase
class OpenWorldUseCase
class AcceptAssistantProposalUseCase
class AuthorizationPolicy {
  +require(Principal, ResourceId, Permission)
}
class ProposalAcceptancePolicy
class CapabilityPolicy

ManuscriptController --> RequestContext
StoryWorldController --> RequestContext
WorldCatalogController --> RequestContext
AssistantController --> RequestContext
ManuscriptController --> ManuscriptApplicationPort
StoryWorldController --> StoryWorldApplicationPort
WorldCatalogController --> WorldCatalogApplicationPort
AssistantController --> AssistantApplicationPort
ManuscriptApplicationPort <|.. SaveChapterUseCase
StoryWorldApplicationPort <|.. ApplyStoryWorldMutationUseCase
WorldCatalogApplicationPort <|.. OpenWorldUseCase
AssistantApplicationPort <|.. AcceptAssistantProposalUseCase
SaveChapterUseCase --> AuthorizationPolicy
ApplyStoryWorldMutationUseCase --> AuthorizationPolicy
OpenWorldUseCase --> AuthorizationPolicy
AcceptAssistantProposalUseCase --> AuthorizationPolicy
AcceptAssistantProposalUseCase --> ProposalAcceptancePolicy
SaveChapterUseCase --> CapabilityPolicy
ApplyStoryWorldMutationUseCase --> CapabilityPolicy
```

The concrete ports are grouped into the namespaced `ApplicationGateway` already
used by the client. A controller maps a versioned transport DTO to exactly one
use case. A use case authorises the request, loads only the state needed for the
operation, invokes deterministic policies and commits through the persistence
port. It does not route by path, expose service instances or dispatch an
unbounded generic command.

The current versioned full-document GET/PUT contracts remain valid migration
inputs. Typed mutations are introduced where they capture real structural
intent, such as Story World changes and Assistant proposal acceptance. Text
editing may continue to use a coalesced chapter/document save instead of
creating a command per keystroke.

## Identity and authorisation

Authentication ends before a typed controller is invoked. Product identity
classes never inspect cookies, headers, redirect query parameters or HTTP
handlers.

```mermaid
classDiagram
direction LR

class TransportAuthMiddleware
class PrincipalResolver {
  +resolve(TransportCredential) Principal
}
class Principal {
  +PrincipalId id
  +OwnerId ownerId
  +ClaimSet claims
}
class SessionRepository {
  <<interface>>
}
class LocalOwnerAuthenticator
class OidcAuthenticator
class OidcProvider {
  <<interface>>
}
class CredentialVault {
  <<interface>>
}
class RenderTokenService
class RequestContext
class TypedController

TransportAuthMiddleware --> PrincipalResolver
PrincipalResolver --> SessionRepository
PrincipalResolver --> LocalOwnerAuthenticator
PrincipalResolver --> OidcAuthenticator
PrincipalResolver --> RenderTokenService
OidcAuthenticator --> OidcProvider
OidcAuthenticator --> CredentialVault
PrincipalResolver --> Principal
RequestContext *-- Principal
TransportAuthMiddleware --> RequestContext
RequestContext --> TypedController
```

The local single-author mode is an authenticator implementation, not a branch
inside every use case. Authorisation is an application concern. Deterministic
core policies receive an `ActorId` only if audit or domain semantics require it;
they do not receive transport identity objects.

## Portable-core bindings

Application use cases consume focused core policy ports. Bindings are adapters;
they do not expose Rust aggregate memory or require a host to choose individual
domain functions.

```mermaid
classDiagram
direction LR

class ManuscriptPolicyPort {
  <<interface>>
}
class StoryWorldPolicyPort {
  <<interface>>
}
class ProposalAcceptancePolicyPort {
  <<interface>>
}
class PythonCoreAdapter
class RustCoreAdapter
class ApplicationContractMapper
class ContractFixtureSuite

PythonCoreAdapter ..|> ManuscriptPolicyPort
PythonCoreAdapter ..|> StoryWorldPolicyPort
PythonCoreAdapter ..|> ProposalAcceptancePolicyPort
RustCoreAdapter ..|> ManuscriptPolicyPort
RustCoreAdapter ..|> StoryWorldPolicyPort
RustCoreAdapter ..|> ProposalAcceptancePolicyPort
PythonCoreAdapter --> ApplicationContractMapper
RustCoreAdapter --> ApplicationContractMapper
ContractFixtureSuite ..> PythonCoreAdapter : verifies
ContractFixtureSuite ..> RustCoreAdapter : verifies
```

Pure deterministic policies can move behind these ports after shared fixtures
exist. Storage ownership is different: Python and Rust must never migrate
SQLite writes operation by operation. One runtime owns the complete persistence
boundary for a target profile. A Rust storage cutover is considered only at a
concrete native/mobile milestone and happens as one measured boundary change.

## Atomic persistence and immediate indexes

```mermaid
classDiagram
direction LR

class CommitPlan {
  +ExpectedRevision[] expected
  +DocumentChange[] documents
  +IndexDelta[] referenceDeltas
  +IndexDelta[] searchDeltas
  +ProjectionJob[] afterCommitJobs
  +IdempotencyKey idempotencyKey
}
class CommitReceipt {
  +RevisionVector revisions
  +ChangedEntityId[] changedEntities
}
class WorldCommitRepository {
  <<interface>>
  +commit(CommitPlan) CommitReceipt
}
class SQLiteWorldCommitRepository
class SQLiteTransaction
class SQLiteManuscriptRepository
class SQLiteStoryWorldRepository
class TransactionalReferenceIndex
class TransactionalSearchIndex
class ProjectionJobStore
class ProjectionRunner {
  +runPending()
}
class ProjectionJobHandler {
  <<interface>>
  +run(ProjectionJob)
}
class FileMirrorJobHandler
class RemoteBackupJobHandler
class ThumbnailJobHandler

SQLiteWorldCommitRepository ..|> WorldCommitRepository
SQLiteWorldCommitRepository *-- SQLiteTransaction
SQLiteWorldCommitRepository --> SQLiteManuscriptRepository
SQLiteWorldCommitRepository --> SQLiteStoryWorldRepository
SQLiteWorldCommitRepository --> TransactionalReferenceIndex
SQLiteWorldCommitRepository --> TransactionalSearchIndex
SQLiteWorldCommitRepository --> ProjectionJobStore
CommitPlan --> WorldCommitRepository
WorldCommitRepository --> CommitReceipt
ProjectionRunner --> ProjectionJobStore : claims committed jobs
ProjectionRunner --> ProjectionJobHandler
FileMirrorJobHandler ..|> ProjectionJobHandler
RemoteBackupJobHandler ..|> ProjectionJobHandler
ThumbnailJobHandler ..|> ProjectionJobHandler
```

`WorldCommitRepository.commit(CommitPlan)` guarantees one SQLite transaction.
Changed documents, expected/new revisions, the idempotency receipt, immediately
required FTS/reference-index deltas and durable after-commit jobs either all
commit or all roll back.

`projection_jobs` is not a general domain-event bus. It is reserved for real
side effects that cannot participate in the SQLite transaction, such as file
mirrors, remote backup uploads and generated thumbnails. Handlers are
idempotent and retryable. Search and reference indexes required by the next
request are updated transactionally, not eventually by a runner.

## Canonical mutation sequence

```mermaid
sequenceDiagram
    participant Adapter as HTTP / Native / CLI / MCP adapter
    participant Auth as PrincipalResolver
    participant Controller as Context controller
    participant UseCase as Focused application use case
    participant Policy as Deterministic policy port
    participant Commit as WorldCommitRepository
    participant DB as SQLite transaction
    participant Runner as ProjectionRunner

    Adapter->>Auth: transport credentials
    Auth-->>Adapter: Principal
    Adapter->>Controller: RequestContext + versioned DTO
    Controller->>UseCase: typed request
    UseCase->>UseCase: authorise + check capability
    UseCase->>UseCase: load operation-specific state
    UseCase->>Policy: validate and derive changes
    Policy-->>UseCase: mutation outcome
    UseCase->>Commit: commit(CommitPlan)
    Commit->>DB: begin
    Commit->>DB: documents + revisions + immediate indexes + jobs
    DB-->>Commit: commit or rollback as one transaction
    Commit-->>UseCase: CommitReceipt
    UseCase-->>Adapter: mapped application result
    Runner->>Runner: retry committed external side effects
```

There is no global world lock and no requirement to hydrate a complete
`WorldProjectSnapshot` for every operation. Each use case declares its read and
write set; cross-document invariants load both sides only when necessary.
Unrelated worlds and unrelated revision lanes can commit concurrently.

## Current code to target responsibility

| Current code                                                | Target class/responsibility                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `WebApplication.route_services(path)`                       | typed controller registration and focused port injection        |
| client namespaced `ApplicationGateway`                      | retained public grouping of context-specific application ports  |
| route-service dataclasses typed as `Any`                    | explicit controller constructor ports                           |
| `Identity.resolve(handler)` and HTTP-aware identity service | transport middleware plus `PrincipalResolver`                   |
| `DocumentRepository` with raw `Path`/`dict`                 | owned repository values behind focused use cases                |
| `DocumentUseCases.save`                                     | save use case plus atomic `WorldCommitRepository`               |
| database commit followed by mirror write                    | transactional `projection_jobs` plus idempotent side-effect job |
| rebuilt FTS/reference data after commit                     | `IndexDelta` written inside the document transaction            |
| one global web lock                                         | optimistic revisions and operation-scoped transaction locking   |
| current `quiltor-core` timeline function                    | one deterministic policy behind a focused port                  |
| FFI contract-version function only                          | versioned high-level policy calls after contract fixtures exist |

## Support-service outbound ports

Support use cases consume focused ports owned by their application context:

- backup repository and remote backup gateway;
- history reader, change log and named snapshot store;
- OIDC provider, session repository and credential vault;
- asset import, document selection/handles and PDF renderer;
- proofreading dictionaries/services;
- commerce receipt/licence verification;
- lifecycle, scheduling, updates, diagnostics and observability.

Concrete platform, store or vendor names occur only in adapters and bootstrap.
