# Quiltor architecture

Quiltor is a local-first modular monolith with several executable hosts. Product
behaviour is independent from the operating system and from the channel that
distributed a build.

The architecture is organised around six independent axes:

1. **Product modules** — manuscript, story world, storyboard, writing tools,
   assistant, import/export, history, backup, identity and commerce.
2. **Hosts** — browser, desktop, mobile, CLI and MCP.
3. **Platforms** — Windows, macOS, Linux, iOS, Android and browser.
4. **Distribution targets** — direct download, stores, containers and Python
   packages.
5. **Release channels** — stable, beta, nightly and store test tracks.
6. **Entitlements** — capabilities granted by a purchase, subscription or
   direct licence.

An available feature is the intersection of the host capability, platform
capability, distribution constraint and user entitlement. None of these is a
synonym for another.

## Repository layout

```text
apps/                 repository-level shells and native project roots
packages/client/      shared React client
locales/              contributor-facing UI locale packs
contracts/            versioned cross-runtime contracts and fixtures
crates/                portable local core and language bindings
src/quiltor/           packaged Python product, adapters and host entrypoints
services/              independently deployed services
distribution/          build profiles, packaging and store metadata
tests/                 cross-cutting integration, contract and E2E tests
tools/                 quality, evaluation and documentation tooling
docs/                  product, architecture, operations and contribution docs
```

Not every directory needs every layer. A small product module stays small.
Names such as `core`, `common`, `utils`, `misc`, `data`, `tools` or `service`
must not become unowned application buckets.

The split between `apps/` and `src/quiltor/hosts/` is about packaging, not two
competing host models. Browser/native project shells stay visible at repository
level; CLI, desktop, MCP and HTTP entrypoints that must ship in the Python wheel
stay inside the `quiltor` package. Both are composition roots and neither owns
product behaviour. See `apps/README.md`.

Repository automation and shipped subprocesses are separate ownership classes.
Quality, evaluation and documentation automation lives under the explicit
categories in `tools/` and is never imported or shipped by the application.
Reviewed subprocess assets that are part of the product live under
`src/quiltor/resources/sidecars/`; the package resource resolver exposes only an
allowlisted asset, never an arbitrary repository script.

## Dependency direction

The normative ownership boundaries and current gap assessment are documented
in [`target-component-model.md`](target-component-model.md). The independently
releasable sequence, complexity triggers and phase gates live in the
[`implementation-plan.md`](implementation-plan.md). Detailed UML classes are
reference designs until their phase is implemented. If a proposed diagram and
the implementation plan differ, the implementation plan is authoritative.

```text
hosts ──────► application/use cases ──────► domain
   │                    ▲
   └────► platform adapters ─────► declared ports

bootstrap ─► hosts + concrete adapters + build profile
```

- Domain code imports no UI, HTTP, SQLite, filesystem, OS or model runtime.
- Product modules call small ports, not platform or store names.
- Hosts compose modules; product modules do not import hosts.
- Frontend modules use `QuiltorClient` and `PlatformGateway`; they do not call
  `fetch`, `window.pywebview` or native APIs directly.
- HTTP, the native bridge and MCP are transports over the same application
  operations.
- Distribution profiles contain immutable build facts. Runtime OS detection
  validates those facts but never invents a distribution channel.

## Stable product aggregates

- `ManuscriptDocument` owns chapters, formatting, notes and story-time anchors.
- `StoryWorldDocument` owns `StoryWorld` facts (elements, relationships,
  timeline, presence and time systems) plus a separately modelled
  `StoryWorldLayout`. Figures, Places and Timeline are projections of this
  aggregate.
- `StoryboardDocument` independently owns author-created boards, planning
  nodes, visual connections and their layout. Its `storyboards_revision`
  advances without changing Manuscript or Story World revisions. Storyboard
  data is authoritative planning material, but it is never a source for
  `StoryWorld` facts or `WorldState(t)` merely because it was saved.
- Assistant mutations remain proposals until the author accepts them.
- Project-owned media is imported into a `WorldAssetRepository`; canonical
  documents store a stable asset ID rather than a platform path or document
  handle.
- Writing settings, user preferences and embedded runtime facts have separate
  owners.

The public wire format and supported SQLite schemas remain versioned contracts.
Internal names may improve without silently rewriting user data.

Every shipped Note keeps its author text as a plain string. Stable `noteReferences`
and presentation-only `noteMarks` are parallel UTF-16 ranges over that same string;
the latter currently supports bold, italic and single-line heading levels 1–3.
Chapter, Story World and Storyboard documents validate and persist this shared
shape through their own aggregate ports. Search, backlinks and Assistant context
continue to consume the plain text so presentation metadata cannot change meaning
or invalidate reference surfaces.

## Platform boundaries

Platform integration is expressed through focused capabilities rather than one
large platform interface:

- application directories;
- settings and credential vaults;
- document selection/export and persistent document handles;
- external authentication and navigation;
- clipboard and sharing;
- process supervision and inference;
- proofreading;
- PDF rendering;
- background scheduling and lifecycle;
- deep links, updates and diagnostics.

Desktop-only concepts such as windows and tray icons remain desktop-host
internals. Mobile hosts implement lifecycle, document and authentication ports
without pretending to support desktop processes.

## Localisation

UI localisation lives in the root `locales/` directory so a translation pull
request is easy to discover and review. Runtime code lives in
`packages/client/src/i18n/`. Manuscript writing locale, proofreading resources,
assistant response locale, installer copy and store listing copy are separate
concepts.

## Definition of an additive platform

Adding a new distribution target may add:

1. one declarative build profile;
2. missing platform adapter implementations;
3. packaging/signing configuration;
4. a build and publish workflow;
5. target-specific tests and store metadata.

It must not require moving or branching manuscript, story-world, timeline or
assistant product logic.

## Source tree

```text
apps/                        visible shells and native project roots
├── web/server.py            source-checkout bootstrap
└── mobile/{ios,android}/     future native mobile host scaffolds

src/quiltor/
├── domain/story_world/      pure world logic, chronology, and validation
├── application/             shared use cases and domain-facing ports
├── modules/                 assistant, writing aid, identity, and commerce
├── infrastructure/          SQLite, backup, inference, PDF, platform adapters
├── resources/sidecars/      shipped PDF and inference subprocess assets
├── bootstrap/               composition root for concrete adapters
├── delivery/http/routes/    HTTP endpoints grouped by capability
└── hosts/                   web server, desktop, CLI, and MCP

services/backup-server/      independently deployable backup service
contracts/                   versioned application and native-bridge contracts
crates/                      pure Rust timeline kernel and FFI foundation
distribution/                target profiles, builds, installers, stores, signing
tools/                       quality, evaluation, and documentation tooling

packages/client/src/
├── app/                     composition, shell, session, navigation, overlays
├── config/                  application configuration and branding
├── design/                  design tokens and presentation foundations
├── i18n/                    locale runtime, provider, and catalog loader
├── modules/
│   ├── manuscript/          editor and writing aids
│   ├── story-world/         figures, places, timeline, and world management
│   ├── storyboard/          independent visual planning workspace
│   ├── graph/               shared graph interaction and presentation
│   ├── assistant/           local assistant
│   ├── identity/            sign-in and identity
│   ├── backup/              local backup restoration
│   ├── history/             history and snapshots
│   ├── search/              search and navigation
│   ├── notes/               linked notes
│   └── world-references/    reference projections and backlinks
├── platform/                application ports, HTTP transport, host adapters
└── shared/                  domain-neutral foundations only

locales/                      contributor-friendly UI translation packs
```

Dependency direction is intentional:

```text
Hosts/Delivery → Application use cases → Domain
Bootstrap → Application ports + concrete infrastructure adapters
Domain/Application ↛ infrastructure/delivery/hosts
```

The normative target component model and current-state assessment live in
[`docs/architecture/target-component-model.md`](target-component-model.md).
The approved implementation sequence, complexity triggers and exit gates live
in [`docs/architecture/implementation-plan.md`](implementation-plan.md).

The normal server path stays small and local; additional capabilities are added through clearly separated modules and distribution extras.

Python application services and SQLite remain the authoritative implementation and storage
path. The Rust crates currently provide a small pure timeline kernel and its ABI/FFI
foundation; they do not yet replace Python persistence or provide complete native mobile
hosts. Manuscript, Story World, and Storyboard are independently revisioned documents.
Figures, Places, and Timeline project the same Story World; Storyboard remains separate
author-owned planning data. The session, transaction and inference rework described in the
architecture plan is a target picture and must not be read as already implemented.
