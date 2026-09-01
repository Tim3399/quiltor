# Cross-feature projections and navigation

Status: **proposed target view**

Answers: **How do Manuscript, Story World and Storyboard feed navigation,
search, backlinks and Assistant context without duplicating canonical or
planning state?**

Client and application projections serve different consistency needs and must
not be conflated:

- client projections are ephemeral overlays for unsaved drafts, navigation and
  immediate UI feedback;
- canonical reference and FTS/search indexes are updated in the same SQLite
  transaction as the documents they describe;
- canonical Assistant context is built in the Assistant application/backend
  from committed read models plus an explicit bounded draft overlay.

No client projection is an aggregate or a second authority.

## Projection ownership

```mermaid
flowchart LR
    subgraph Client["Client: ephemeral draft and navigation"]
        ManuscriptDraft["ManuscriptDraftStore"]
        StoryWorldDraft["StoryWorldDraftStore"]
        StoryboardDraft["StoryboardDraftStore"]
        DraftCoordinator["DraftNavigationProjectionCoordinator"]
        DraftReference["DraftReferenceOverlay"]
        DraftSearch["DraftSearchOverlay"]
        Navigation["NavigationService"]

        ManuscriptDraft --> DraftCoordinator
        StoryWorldDraft --> DraftCoordinator
        StoryboardDraft --> DraftCoordinator
        DraftCoordinator --> DraftReference
        DraftCoordinator --> DraftSearch
        DraftReference --> Navigation
        DraftSearch --> Navigation
    end

    subgraph Application["Application/backend: canonical read models"]
        Commit["WorldCommitRepository"]
        ReferenceIndex["TransactionalReferenceIndex"]
        SearchIndex["TransactionalSearchIndex"]
        ContextBuilder["CanonicalAssistantContextBuilder"]

        Commit --> ReferenceIndex
        Commit --> SearchIndex
        ReferenceIndex --> ContextBuilder
        SearchIndex --> ContextBuilder
    end

    DraftCoordinator -.->|"flush or explicit DraftContext"| ContextBuilder
    ReferenceIndex --> Navigation
    SearchIndex --> Navigation
```

`DraftNavigationProjectionCoordinator` depends only on public draft/read-model
contracts. It may merge committed results with unsaved local overlays for the
visible author session. That merge is a UI convenience and is discarded or
rebuilt on reload.

`TransactionalReferenceIndex` and `TransactionalSearchIndex` are persistent
application read models. Their `IndexDelta`s are part of `CommitPlan`; therefore
a newly committed document and its immediately required search/backlink state
cannot disagree. They are not `projection_jobs`.

## Neutral projection values

```mermaid
classDiagram
direction TB

class ReferenceTarget {
  +ReferenceKind kind
  +StableId id
}
class ReferenceSource {
  +ReferenceSourceId source
  +ReferenceTarget target
  +TextRange range
}
class ReferenceCandidate {
  +ReferenceTarget target
  +string label
  +WorkspaceTarget destination
}
class ReferenceBacklink {
  +ReferenceTarget target
  +ReferenceSourceId source
  +WorkspaceTarget destination
}
class SearchEntry {
  +SearchEntryId id
  +string title
  +string searchableText
  +WorkspaceTarget destination
}
class DraftContext {
  +Revision baseRevision
  +DraftFragment[] fragments
  +EvidenceId[] replaces
}
class WorkspaceTarget {
  +WorkspaceId workspace
  +StableId entityId
}

ReferenceSource *-- ReferenceTarget
ReferenceCandidate *-- ReferenceTarget
ReferenceCandidate *-- WorkspaceTarget
ReferenceBacklink *-- ReferenceTarget
ReferenceBacklink *-- WorkspaceTarget
SearchEntry *-- WorkspaceTarget
DraftContext --> ReferenceSource
DraftContext --> SearchEntry
```

`ReferenceTarget` kinds include chapter, world element/place, timeline moment
and Storyboard board. The kind is a contract discriminator, not a permission to
import the owning feature model. `DraftContext` is bounded, revision-stamped
and explicit; it cannot silently replace committed state.

The current client candidate index includes Storyboard boards, so global
search, `@` completion and Storyboard drag/drop share stable targets. The
derived backlink index now also reads Storyboard note references and direct
reference cards, retaining board and node IDs so navigation can select the
exact source card. Storyboard planning text is still not part of canonical
Assistant context until a later, explicitly labelled planning-context use case
is implemented.

## Draft navigation update sequence

```mermaid
sequenceDiagram
    participant Session as WorldEditorSession
    participant Store as Feature DraftStore
    participant Drafts as DraftNavigationProjectionCoordinator
    participant Canonical as Canonical reference/search readers
    participant UI as Notes / Search / Navigation UI

    Session->>Store: local draft change
    Store-->>Drafts: affected draft keys
    Drafts->>Canonical: read committed base entries
    Drafts->>Drafts: replace only affected local overlays
    Drafts-->>UI: merged navigation/search view
```

Draft updates use affected keys and do not rebuild every entry after each
keystroke. Full rebuild remains available after load, migration and recovery.
The client does not build Assistant evidence in this sequence.

## Assistant context sequence

```mermaid
sequenceDiagram
    actor Author
    participant Client as Assistant client
    participant Sync as DraftSyncPolicy
    participant Application as AssistantApplicationPort
    participant Context as CanonicalAssistantContextBuilder
    participant Readers as Canonical read models

    Author->>Client: ask with current selection
    Client->>Sync: prepare current draft state
    alt normal online/local save path
        Sync->>Application: flush draft and obtain committed revision
        Application-->>Sync: commit receipt
        Sync->>Application: request + committed revision
    else explicit unsaved context is required
        Sync->>Application: request + bounded DraftContext
    end
    Application->>Context: build selection context
    Context->>Readers: read committed manuscript/world/index state
    Readers-->>Context: canonical evidence
    Context->>Context: validate and apply optional overlay
    Context-->>Application: bounded evidence set
```

The default is to flush current drafts before inference. An explicit overlay is
reserved for cases where saving first would violate the interaction contract.
Its base revision and replacement scope are validated before it contributes to
evidence.

## Rename integration

A world-element rename derives reference/search `IndexDelta`s inside the same
commit as the canonical name. Stored manuscript surface text is author content
and is not silently rewritten. A `MentionRenameWorkflow` may offer reviewed
replacement mutations for affected occurrences.

```mermaid
flowchart LR
    Rename["RenameWorldElement mutation"] --> Policy["Rename policy"]
    Policy --> Plan["CommitPlan: entity + index deltas"]
    Plan --> Commit["Atomic SQLite commit"]
    Commit --> Receipt["CommitReceipt: changed entity IDs"]
    Receipt --> Client["Refresh affected draft/navigation entries"]
    Commit --> Workflow["MentionRenameWorkflow"]
    Workflow --> Decision{"Author accepts text replacements?"}
    Decision -->|"yes"| Mutation["ReplaceMentionSurface mutation"]
    Decision -->|"no"| Keep["Keep manuscript wording"]
```

Internal domain facts may help policies derive a `CommitPlan`, but raw domain
events are not exposed as a public client protocol.

## Current code to target responsibility

| Current code                                                                                    | Target class/responsibility                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `buildWorldReferenceCandidates` and `buildWorldReferenceBacklinks` over all three loaded drafts | client `DraftReferenceOverlay` plus canonical reference reader  |
| separate candidate building in Search                                                           | canonical index plus affected client `DraftSearchOverlay`       |
| `NoteReferenceProvider` with aggregate-derived values                                           | Notes consuming merged canonical/draft reference views          |
| `KnowledgeChunk` rebuilding in Assistant backend                                                | `CanonicalAssistantContextBuilder` over committed read models   |
| any client-built Assistant context                                                              | removed; flush or pass an explicit `DraftContext`               |
| nested rename detection in `Application.tsx`                                                    | rename policy, transactional index deltas and reviewed workflow |
| direct workspace-target conversion scattered by feature                                         | one client `NavigationService` over `WorkspaceTarget`           |

Canonical changes travel through the focused application path described in
[application/persistence](application-and-persistence.md). Assistant-specific
acceptance and evidence rules are described in
[assistant/inference](assistant-and-inference.md).
