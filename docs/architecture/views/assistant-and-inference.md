# Assistant and replaceable inference

Status: **proposed target view**

Answers: **How does Quiltor use AI without coupling product behaviour to a
model/runtime, while introducing only the infrastructure the product needs?**

The Assistant product and inference execution are separate modules joined by a
consumer-owned port. This seam is required now. A multi-provider registry,
automatic selector and model-package control plane are optional extensions and
are introduced only when a second supported provider, user-installable model or
distribution requirement creates the need.

## Product-side Assistant and acceptance

```mermaid
classDiagram
direction LR

class AssistantController
class AssistantOrchestrator {
  +respond(RequestContext, AssistantRequest) AssistantReply
}
class CanonicalAssistantContextBuilder {
  +build(WorldId, ContextSelection, DraftContext) AssistantContext
}
class AssistantReadToolExecutor {
  <<interface>>
  +catalog() ReadToolDefinition[]
  +execute(ReadToolCall[]) ReadToolResult[]
}
class AssistantInferencePort {
  <<interface>>
  +capabilities() InferenceCapabilities
  +generate(InferenceRequest) InferenceResult
  +countTokens(text) TokenCount
}
class ProposalVerifier {
  +verify(InferenceResult, EvidenceSet) AssistantProposalEnvelope[]
}
class AcceptAssistantProposalUseCase {
  +execute(RequestContext, AcceptProposalRequest) CommitResult
}
class AuthorizationPolicy {
  +require(Principal, WorldId, Permission)
}
class ProposalAcceptancePolicy {
  +evaluate(Proposal, ResolutionProof, CurrentState) AcceptedMutation
}
class WorldCommitRepository {
  <<interface>>
}

AssistantController --> AssistantOrchestrator
AssistantOrchestrator *-- CanonicalAssistantContextBuilder
AssistantOrchestrator --> AssistantReadToolExecutor
AssistantOrchestrator --> AssistantInferencePort
AssistantOrchestrator *-- ProposalVerifier
ProposalVerifier --> AcceptAssistantProposalUseCase : verified envelope
AssistantController --> AcceptAssistantProposalUseCase : explicit author decision
AcceptAssistantProposalUseCase --> AuthorizationPolicy
AcceptAssistantProposalUseCase --> ProposalAcceptancePolicy
AcceptAssistantProposalUseCase --> WorldCommitRepository
```

`ProposalVerifier` checks response shape, declared evidence and proposal bounds.
It does not authorise a mutation. Every accepted proposal travels through
`AcceptAssistantProposalUseCase`, even when inference and the application run in
the same process. The use case requires an explicit author decision, applies
`AuthorizationPolicy`, then applies deterministic `ProposalAcceptancePolicy`
checks for stale proofs, entity resolution and domain invariants before committing through
the normal atomic persistence path. Rejection creates no mutation.

The canonical context builder belongs to the Assistant application/backend
side. It reads committed canonical read models. Unsaved editor content is either
flushed before the request or supplied as an explicit, bounded `DraftContext`;
the Assistant never silently consumes a client-only projection as canonical
world state.

## Product-owned inference contract

These values contain no provider, URL, executable, process or model-path field:

```mermaid
classDiagram
direction TB

class InferenceRequest {
  +ConversationMessage[] messages
  +ToolDefinition[] tools
  +StructuredOutputSchema outputSchema
  +InferenceBudget budget
  +PrivacyRequirement privacy
}
class InferenceResult {
  +GeneratedContent content
  +ToolCall[] toolCalls
  +FinishReason finishReason
  +Usage usage
}
class InferenceCapabilities {
  +int contextTokens
  +bool structuredOutput
  +bool toolCalling
  +bool tokenCounting
  +ExecutionLocality locality
  +PrivacyClass privacyClass
}
class InferenceBudget {
  +int maxInputTokens
  +int maxOutputTokens
  +Duration timeout
}
class AssistantInferencePort {
  <<interface>>
}

AssistantInferencePort ..> InferenceRequest
AssistantInferencePort --> InferenceResult
AssistantInferencePort --> InferenceCapabilities
InferenceRequest *-- InferenceBudget
```

Product policy adapts to reported capabilities. It does not assume one fixed
context window or use a runtime name to choose behaviour.

## Required provider seam

```mermaid
classDiagram
direction LR

class AssistantInferencePort {
  <<interface>>
}
class ConfiguredInferenceAdapter
class ProviderSession {
  <<interface>>
  +capabilities() InferenceCapabilities
  +generate(InferenceRequest) InferenceResult
}
class LocalProviderSession
class RemoteProviderSession
class PrivacyConsentPolicy
class CredentialVault {
  <<interface>>
}

ConfiguredInferenceAdapter ..|> AssistantInferencePort
ConfiguredInferenceAdapter --> ProviderSession
LocalProviderSession ..|> ProviderSession
RemoteProviderSession ..|> ProviderSession
ConfiguredInferenceAdapter --> PrivacyConsentPolicy
RemoteProviderSession --> CredentialVault
```

The composition root injects one configured provider session. Local execution
is the default. Remote execution is eligible only after an explicit user choice,
current consent for the privacy class and a credential stored in the vault.
Adding this port now keeps Assistant semantics independent without prematurely
building a provider marketplace.

## Trigger-based provider selection and control plane

The following is a **conditional reference design**, not required baseline
infrastructure. Introduce it when at least one of these triggers exists:

- two provider/model options are supported as product choices;
- users can install or remove model packages;
- hardware compatibility requires deterministic option selection;
- a distribution channel exposes a materially different model catalogue.

```mermaid
classDiagram
direction LR

class InferenceProviderRouter
class ProviderSelector {
  +select(SelectionContext) ProviderSelection
}
class ProviderRegistry
class ModelCatalog
class ModelManager
class ModelPackageStore {
  <<interface>>
}
class HardwareProfilePort {
  <<interface>>
}
class UserInferencePreferenceRepository {
  <<interface>>
}
class PrivacyConsentPolicy

InferenceProviderRouter --> ProviderSelector
InferenceProviderRouter --> ProviderRegistry
ProviderSelector --> ModelCatalog
ProviderSelector --> HardwareProfilePort
ProviderSelector --> UserInferencePreferenceRepository
ProviderSelector --> PrivacyConsentPolicy
ModelManager --> ModelCatalog
ModelManager --> ModelPackageStore
```

When activated, selection is deterministic and explainable: the result includes
the chosen option and rejection reasons for incompatible alternatives. Package
installation remains a settings/control-plane workflow, never an Assistant
conversation operation. Store builds may restrict packages while direct builds
allow verified downloads; the Assistant product sees only capabilities.

## End-to-end Assistant sequence

```mermaid
sequenceDiagram
    actor Author
    participant Controller as AssistantController
    participant Drafts as DraftSyncPolicy
    participant Assistant as AssistantOrchestrator
    participant Context as CanonicalAssistantContextBuilder
    participant Port as AssistantInferencePort
    participant Verify as ProposalVerifier
    participant Accept as AcceptAssistantProposalUseCase
    participant Authz as AuthorizationPolicy
    participant Policy as ProposalAcceptancePolicy
    participant Commit as WorldCommitRepository

    Author->>Controller: question / extraction request
    Controller->>Drafts: flush or create bounded DraftContext
    Drafts-->>Assistant: committed revision + optional DraftContext
    Assistant->>Context: build canonical bounded context
    Context-->>Assistant: evidence set
    Assistant->>Port: generate(provider-neutral request)
    Port-->>Assistant: provider-neutral result
    Assistant->>Verify: verify(result, evidence)
    Verify-->>Author: reply + proposal envelopes
    alt author explicitly accepts proposal
        Author->>Accept: AcceptProposalRequest
        Accept->>Authz: require mutation permission
        Accept->>Policy: stale proof + resolution + invariants
        Policy-->>Accept: accepted mutation or rejection
        Accept->>Commit: commit(CommitPlan)
        Commit-->>Author: committed result
    else author rejects
        Author-->>Controller: no state change
    end
```

Read-tool calls are validated and evidence-bound inside the orchestration loop.
They do not create an alternate write route.

## Current code to target responsibility

| Current code                                                  | Target class/responsibility                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `InferenceEngine.identity/status/reload/close/invoke(dict)`   | `AssistantInferencePort` plus host-owned provider lifecycle                   |
| fixed product context assumptions                             | `InferenceCapabilities` and `InferenceBudget`                                 |
| OS/environment heuristic for llama.cpp versus MLX             | composition-selected provider now; `ProviderSelector` only after a trigger    |
| `AssistantInstallation`                                       | conditional settings control plane when user-installable packages are offered |
| raw installation/provider state in Assistant UI               | dedicated inference settings read model, when the control plane exists        |
| client-side aggregate cloning in `applyAssistantProposals`    | `AcceptAssistantProposalUseCase` through authorisation and acceptance policy  |
| `ResolutionProof`, `EnsureDecision`, `WorldResolutionContext` | deterministic `ProposalAcceptancePolicy`                                      |
| client-built Assistant knowledge projection                   | canonical backend builder plus explicit `DraftContext`                        |
| `AssistantJobStore`, progress and interaction logging         | Assistant infrastructure independent of provider selection                    |

Adding a provider always requires a conforming `ProviderSession` adapter and
contract tests. It requires a registry or package manager only after the stated
product triggers occur.
