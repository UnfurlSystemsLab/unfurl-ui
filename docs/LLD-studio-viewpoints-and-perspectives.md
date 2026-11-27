# LLD: Studio Views and Perspective Overlays

**Status:** P1 implemented (`apps/fabric-studio-webapp/src/workbench/`, Fabric's layout extension and permissive
trust policy warning). P2a implemented: compile records, contract diff and verification in the compile panel, typed
guided-fix cards, and the verification in Security & Trust (§10). P2b implemented: Data & State, Runtime & Telemetry,
external owners and `external_protocol` offers in Flow & Composition, and transports in Substrate & Topology, all from
Fabric's `views/*` (§10). The rest of P2, and P3 and Later, are designed. This document is the source of truth for how the Studio workbench
is organised. `LLD-unfurl-studio-visual-composition.md` §19A summarises it, and the Fabric endpoints it depends on are
specified in `unfurl-fabric/docs/LLD-fabric-studio-api.md` ("Views and Overlays").

**Section references:** "VC §n" means section n of `LLD-unfurl-studio-visual-composition.md`. A bare "§n" means a
section of this document. "DCP HLD-C2" means `unfurl-dcp/docs/HLD-C2-dcp-schema-spec-updated.md`. "HLD-E" means
`unfurl-deploy-emitter/docs/HLD-E-deployment-emitter.md`.

## 1. Purpose

Studio serves small businesses, enterprises and, in future, embedded and edge systems through one workbench. It has to
start with no modelling process and still give an architect every structural and quality concern on request. This
document applies the viewpoint and perspective framework of Rozanski and Woods (*Software Systems Architecture*),
itself built on the IEEE 1471 / ISO/IEC/IEEE 42010 notion of viewpoints, in a reduced form:

- **4 views** instead of the book's 7 viewpoints, because separate diagrams for Concurrency, Information and Development
  would recreate the heavy process this product is meant to remove.
- **4 perspective overlays** instead of the book's 10 perspectives.

The framework's partition is adopted. Its notations (UML, SysML, C4 diagrams) are not (VC §19A, Notation decision).

Two rules govern everything below:

1. **Disclosure changes what you see, never what is checked** (VC §19A). Views, overlays and renderers are view state
   (VC §24). They are never sent in an intent, never stored in a contract, and never change a Fabric gate.
2. **A view or overlay exists only where Fabric supplies real data for it** (engineering rule 2). When the data is
   absent, Studio says so. It never shows a placeholder, a default or an inferred value.

## 2. Three independent axes

Every workbench screen is a combination of three independent choices:

| Axis | Values | Chooses |
|---|---|---|
| **View** | Flow & Composition, Data & State, Substrate & Topology, Runtime & Telemetry | Which *structure* is drawn |
| **Perspective overlay** | Security & Trust, Performance & Load, Resilience & Faults, Compliance & Governance | Which *quality* annotates that structure |
| **Renderer** | 3D, 2D, Table | *How* it is drawn |

Rozanski and Woods treat perspectives as orthogonal to viewpoints: a perspective is applied *to* a view and never forms
a view of its own. Studio follows that rule. An overlay annotates the elements of the active view and has no screen of
its own.

## 3. The four views

Status values: **P1** means the data reaches Studio as typed fields today. **P2** means it needs the typed Fabric view
and overlay endpoints. **P3** means it needs DCP schema work first (register in DCP HLD-C2 §I.1).

### 3.1 Flow & Composition (always offered, the default)

*Rozanski and Woods:* Context + Functional.

| Content | Source | Status |
|---|---|---|
| Components, nesting (`CONTAINS`), drill-down | `GET .../dynamic-dcp` nodes and edges | P1 |
| Needs-to-offers wiring with per-connection status and reason | `/dynamic-dcp` `connections` | P1 |
| Refusals as capped ports (VC §8) | visual manifest ports of kind `REFUSAL` | P1 |
| Replacement candidates (ALLOWED / BLOCKED plus reason) | `/dynamic-dcp/replacements` | P1 |
| External owners as boundary nodes: dependencies qualified `owner=host`, `owner=fabric`, `owner=customer-controlled` or a concrete customer owner such as `owner=customer-idp` | Fabric `views/flow` `externalOwners` (DCP `Dependencies.ownerOf` over claim `dependencies`); one boundary node per owner, joined to each component needing it | P2b. Studio does not parse dependency strings. |
| Offers reached over the provider's own protocol (`interface.kind: external_protocol`) | Fabric `views/flow` `externalProtocolOffers` (DCP HLD-C2 A.6), as a fact on the provider | P2b |

This view replaces today's Assembly, Exploded and Ports tabs. The context content is shown at the boundary of the
same canvas rather than in a separate context diagram. That keeps one picture of the system, which is the main reason
for merging the two book viewpoints.

### 3.2 Data & State (offered when data exists)

*Rozanski and Woods:* Information.

**Offered when** Fabric's `views/data` has at least one available section: a selected claim declares
`domain.concerns[].owns_state` or `owns_decisions`, or documents its operations, or the current compile has a data
mapping. Otherwise the view is under "More views" with Fabric's reasons. Later the emit plan preview's state store or
named volumes will count too, once the `EmitManifest` gap in HLD-E §3 is closed.

| Content | Source | Status |
|---|---|---|
| Owned state per concern, by `sensitivity` (`public`, `internal`, `confidential`, `secret`) | DCP HLD-C2 A.3.2 (`owns_state`), through `views/data` | P2b |
| Owned decisions by `authority` (`exclusive`, `consulted`, `advisory`) | DCP HLD-C2 A.3.3, through `views/data` | P2b |
| Contract `data_mapping` (inbound and outbound) | DCP HLD-C2 §B, from the current compile record through `views/data` | P2b |
| Operation request and response schemas | claim `documentation.operations[]` through `views/data` | P2b; `api_documents` (DCP HLD-C2 A.13) are not projected yet |
| Runtime state store mode (for example `stateStore: IN_MEMORY`) and named volumes (for example `foundry-state`) | emit plan preview, once `EmitManifest` declares them (HLD-E §3, "Gap: deployment facts the manifest does not declare") | P2, after that emitter change |

**Rendering:** the 2D renderer is an ownership matrix (components × owned resources and decisions, cells marked with
sensitivity and authority, `OwnershipMatrixRenderer`), and the Table lists the same elements and ownership edges.
Documented operations and data mappings are facts on their component. There is no 3D renderer.

**Not shown, because DCP carries no such data:** retention periods, PII flows, data residency. These remain absent until
the DCP schema carries them (DCP HLD-C2 §I.1).

### 3.3 Substrate & Topology (always offered)

*Rozanski and Woods:* Deployment + Concurrency.

| Content | Source | Status |
|---|---|---|
| Substrate base plate, required and available substrate ports (VC §9) | `/dynamic-dcp` `substratePorts`; compile `requiredSubstratePorts` | P1 |
| Deployment shapes, selected and rejected shapes with reasons, required ports, isolation matches | `POST /studio/deployment/resolve` (`StudioDeploymentResolveResponse`) | P1 |
| Supported shapes per component | `componentShapeProfile` on catalog entries | P1 |
| Deployment target (for example `local` → `local-compose`, `k8s-dev` → `k8s`) | deployment policy; emit target | P1 for the chosen target |
| Deployment environment: the tenant's environments, one chosen for the emit plan, and their editor (§5.5) | `GET/PUT/DELETE .../deployment-environments` (LLD-fabric-studio-api, *Deployment Environments*) | P2d |
| Emit plan preview: target kind, emitted artifacts with their **preview hashes**, and **secret requests by name, bound component and store hint only, never a value** (for example `UNFURL_FOUNDRY_CREDENTIAL_KEY`, bound to `foundry`, store hint `local-compose-env`), or Fabric's absent reason | `GET .../sessions/{id}/emit-plan?environment` (`StudioEmitPlanPreview`), from `EmitManifest` and `SecretRequest` (HLD-E §3, §5.3) | P2d |
| Named volumes, published ports, `substrateProfileMode` (`STRICT` vs `LEGACY_OPEN_WORLD`) | emit plan preview, once `EmitManifest` declares them (HLD-E §3 gap) | P2, after that emitter change |
| Contract transport kind (`in_process`, `http_json`, `grpc`) | DCP HLD-C2 §B `transport`, from the current compile record through `views/topology`, as a fact on the provider | P2b |
| Runtime bindings as facts on each provider node: capability, deployment kind, base URL, enabled or disabled | the emit plan's `runtimeBindings[]` (DCP HLD-C2 §C), generated for the chosen environment | P2d |
| Concurrency semantics (single instance vs horizontally scalable, ordering, delivery) as badges on components | not yet in DCP | P3 |
| Resource budgets (memory, CPU, worker pools) for embedded and high-load targets | not yet in DCP (quantities and units) | P3 |

This view replaces today's Substrate tab and the separate Deployment route.

Concurrency is merged here rather than given its own view. Instance counts, scaling and worker pools are placement
decisions, so an architect reads them against the topology they apply to. Until DCP declares concurrency semantics,
nothing about concurrency is drawn.

### 3.4 Runtime & Telemetry (pre-release only)

*Rozanski and Woods:* Operational, limited to design time and pre-release.

**Offered when** Fabric's `views/runtime` has at least one available section: a selected claim declares
`integration_ports.monitoring` or `integration_ports.telemetry` (typed in DCP HLD-C2 A.9), or a verification result
exists for the current contract.

| Content | Source | Status |
|---|---|---|
| Declared health, readiness and liveness endpoints | `integration_ports.monitoring` (DCP HLD-C2 A.9) through `views/runtime` | P2b |
| Declared telemetry signals (logs, metrics, traces, audit events) and whether a correlation ID is required | `integration_ports.telemetry` (DCP HLD-C2 A.9) through `views/runtime` | P2b |
| Signed-contract verification result (signature, catalog drift, trust keys) | Fabric `verify` (P2a), carried by `views/runtime` | P2b |
| Verification evidence from a *test deployment* (trace-derived bottlenecks, load results) | separate design (performance verification; not yet written) | Later |

Live production monitoring is not part of Studio. VC §17 reserves runtime operations for Cockpit. Telemetry shown here
always belongs to a named test deployment of a named contract hash, never to production.

**Two places, one boundary.**
- **Workbench (pre-release).** Validating a composition before release belongs here: load and concurrency against a
  named test deployment of a named contract hash. That means Runtime & Telemetry, the Performance & Load overlay, and
  Substrate & Topology's concurrency content once DCP carries it.
- **Cockpit (deployed).** Monitoring deployed apps belongs to Cockpit, a separate surface with its own design. It is not
  a view or overlay of this workbench. Cockpit's first content is the live state of the API catalog
  (`unfurl-api-catalog`): the documentation it serves per component, and its report of each contract's documentation
  status (`ACTIVE`, `PROVIDER_UNREACHABLE`, `NOT_REGISTERED`, ...). The workbench never reads a running deployment, and
  Cockpit never edits a composition.

### 3.5 Not a view: development and catalog

The book's Development viewpoint (module layout, build dependencies) belongs to the component repositories and their
CI. Studio's catalog content (admission, versions, `claimHash`, `artifactSha256`, admission diagnostics) is not a view of
an assembly. It is tenant-level curation:

- **Browsing** happens in the workbench palette.
- **Admission and removal** stay on the tenant-scoped Catalog screen, `/components/fabric-studio/catalog`.
- **Selecting artifacts to admit** (Add Components) builds one selection across browses:
  - Each browse appends its jars to the selection. A jar with the same file name as one already selected replaces
    it, because Fabric admits a jar as `uploaded:<fileName>`.
  - Every selected jar has a remove (×) action. A "Select all" checkbox and "Remove selected" remove several at once.
  - Any change to the selection clears the previous verification result, because that result described another
    selection. Verifying sends the whole selection.
  - Browses are applied in the order they were made, whatever order their file reads finish in, so a later browse of
    the same file name always wins. A read that fails is reported as soon as it fails, even while an earlier browse is
    still being read, and that browse applies nothing. Verifying is unavailable while a browse is being read or a verification is in
    flight.
  - The selection has a revision, which every browse (at the moment it is made, before its files are read) and every
    removal advances. A verification is shown only if the selection is still at the revision it was asked for. A
    later answer still refreshes the catalog from Fabric, because Fabric admitted what it was sent. It never marks
    the changed selection verified, and the screen asks to verify again.
  - The browse control is an "Add component artifacts…" action over the listed selection, not the browser's file-name
    text, which shows only the last browse.

## 4. The four perspective overlays

| Overlay | Rozanski and Woods | Content | Status |
|---|---|---|---|
| **Security & Trust** | Security | identity in the composition: a `/dynamic-dcp` node whose typed `capabilities` include `identity-context` (`unfurl-fabric/docs/HLD-needs-driven-identity.md`); trust policy id (`StudioDraftSession.trustPolicyId`); signing state from the current compile (`SIGNED`, `UNSIGNED_READY`, unsigned-without-keys warning); the session's `TRUST_POLICY_PERMISSIVE` planning warning, which Fabric emits when no trust policy is set (`unfurl-fabric/docs/LLD-fabric-studio-api.md`, *Permissive trust policy warning*) | P1 |
| | | the verification result while current (§4.3 rule 6) | P2a |
| | | Fabric's `overlays/security`: each node's `integration_ports.authentication` and `authorization` (DCP HLD-C2 A.9), labelled "enforced" when a node in the composition provides `identity-context` and "trusted network" otherwise, with the decision owner and permission prefixes; Fabric's "Identity" finding | P2c |
| | | structured trust rejections (empty in session mode until named trust policies are applied: LLD-fabric-studio-api, *Gap: a session's trust policy is not applied*) | after that gap |
| | | Fabric's "Identity in the needs" finding (whether the session's need requires `identity-context`); the emit plan's secret requests by name, bound component and store hint | P2d |
| **Performance & Load** | Performance & Scalability | Fabric's `overlays/performance`: each child contract's `expectations.timeout_ms` on its provider node, from the current compile only (DCP HLD-C2 §B) | P2c |
| | | "runtime timeout N ms" on each provider node, the `runtime_policy.timeout_ms` the emit plan's bindings set (DCP HLD-C2 §C) | P2d |
| | | throughput, latency and resource envelopes | P3 |
| | | bottleneck evidence from a test deployment | Later |
| **Resilience & Faults** | Availability & Resilience | declared faults: `code`, `category`, `severity`, `affects`, `propagation.parent_impact`, `propagates_when`, `remediation.allowed_actions` (DCP HLD-C2 A.10), drawn as propagation paths up the `CONTAINS` tree: Fabric's `overlays/resilience` puts each fault on its component, and a fault whose `parent_impact` is `DEGRADED` or `BLOCKED` on the `CONTAINS` edge to its parent and on the parent, with `propagates_when`. Only the immediate parent is drawn: further escalation is the parent's own policy, known at runtime | P2e (the DCP fault-schema reconciliation, HLD-C2 §I.1 divergence #5, is resolved) |
| **Compliance & Governance** | Regulation + Location | Fabric's `overlays/compliance`: the trust-policy provenance finding (always present, never shown as applied while the gap stands); the current compile's decision audit (selection mode, alternatives considered, selection reasons, score breakdown, planning warnings) with its record, or "Left out" with Fabric's reason; one annotation per node whose telemetry declares `audit_events` | P2c |
| | | "audit enabled" or "audit disabled" on each provider node, the bindings' `runtime_policy.audit_enabled` | P2d |
| | | data residency and region constraints | P3 (no DCP field) |

### 4.1 Overlay applicability

An overlay is offered on a view only when two conditions hold: the reference matrix rates the pair High or Medium, and
the view has data for that overlay. The ratings come from the applicability matrix the user supplied as a reference
(`rozanski-woods-viewpoints-perspectives.md`, Part 3). That matrix is the guide author's heuristic, not normative text
from the book, so recording it here makes it this product's decision.

| | Flow & Composition | Data & State | Substrate & Topology | Runtime & Telemetry |
|---|---|---|---|---|
| Security & Trust | offered | offered | offered | offered |
| Performance & Load | offered | offered | offered | offered |
| Resilience & Faults | offered | offered | offered | offered |
| Compliance & Governance | offered | offered | offered | offered |

The merged views take the higher rating of their source viewpoints:

- Flow & Composition: Functional is High for all four.
- Data & State: Information is High for all four.
- Substrate & Topology: Deployment is High for all four.
- Runtime & Telemetry: Operational is High or Medium for all four.

So every pair is offered, and the data condition alone decides what appears. The matrix still matters for any future
domain overlay (§4.4).

### 4.2 What is not an overlay

- **Evolution.** Version compatibility is already a Fabric gate and appears as a guided fix (VC §19A). Replacement belongs
  to Flow & Composition. Contract diff belongs to the compile panel (§5.3).
- **Accessibility, Usability, Internationalization.** These are qualities of Studio itself (VC §20 accessibility, VC §19A
  progressive disclosure, and Studio's own string externalisation), not qualities of the assembly. DCP has no data for
  them.
- **Development Resource (cost).** The data exists: offer `cost_implications`, `metered`, and
  `integration_ports.ai.cost_metered`. It is a candidate domain overlay (§4.4), not one of the four core overlays.

### 4.3 Overlay rendering rules

1. An overlay only annotates elements of the active view: badges, edge styling, inspector sections and table columns.
   It never adds or removes a component, port, connection or substrate port. An annotation names a node, or an edge by
   its id `RELATIONSHIP:from->to`. The 2D renderer draws an annotated edge as a path, styled by its most severe
   annotation with a title listing them (Resilience & Faults' propagation paths), and the Table renderer lists edge
   badges in its connections table. An edge the active view does not draw keeps none of its annotations.
2. At most one overlay at a time owns the colour channel. Other active overlays use badges. Turning on a second
   colour overlay moves the first one to badges.
3. An overlay with no data for the active view is listed as unavailable with its reason (for example "no selected
   component declares faults"). It is never shown as an empty layer. Availability is decided after the rule-1 guard
   drops annotations on elements the view does not draw: an overlay left with no annotation and no inspector fact is
   unavailable with `NOTHING_IN_VIEW`. A note saying why a source has nothing to add (for example "Runtime timeouts:
   choose a deployment environment") is shown in the inspector but is not a fact, so notes alone never make an overlay
   available.
4. **Overlays never gate.** `substrateProfileMode`, trust policy, refusal alignment, substrate derivation and every
   VC §16 rule run in Fabric whatever the overlays show. No overlay, preset or customer segment selects them.
5. The always-on **guided-fix layer** is not an overlay. It renders `NoMatchExplanation` reasons, candidate conflicts
   and warnings as plain-language cards (VC §19A) and reuses `apps/fabric-studio-webapp/src/draftOverlays.ts`
   (`buildDraftWorkspaceOverlay`).
6. **Stale is never current.** A value derived from a compile or a deployment resolution describes the inputs it was
   produced from: the draft session, the session revision, and the deployment policy it was compiled or resolved with
   (`LLD-fabric-studio-api.md`, *Compile records and freshness*). It is shown on the current elements only when all
   three are the current ones: the same session id, the same revision, and an equal deployment policy.
   - A different session, a later revision, or a changed policy (preferred or disallowed shapes, isolation patterns,
     runtime options) makes it out of date, and the reason is named, for example "produced for session s1; session s2
     is open".
   - A result is pinned only from the response Fabric returned to that request. A request that fails (transport
     error, refusal, no response) pins nothing: the previous result keeps its own inputs, so it stays out of date if
     the inputs have moved on, and the failure is shown as the request's error.
   - Replacing the open session (New Draft, loading an assembly snapshot) clears every compile and resolution result
     of the previous one, so nothing from it can be mistaken for the new session's.
   - Fabric removes the assembly's existing sessions when it imports a snapshot. A snapshot with no session therefore
     leaves no open session: Studio clears the session and its component inventory, and shows "no open draft"
     instead of the removed session's components. Commands that need a session stay unavailable until a draft is
     started or opened.
   - The draft projection (`/dynamic-dcp`) that Flow & Composition and Substrate & Topology draw is pinned the same way,
     to the tenant, assembly, session and revision it was requested for (the assembly alone when no draft is open).
     Only the projection for the current ones is drawn, annotated by overlays, shown in the inspector, or used to
     address an intent (remove, replace). While a refresh is in flight the view reads "loading"; when it fails the view
     is unavailable with Fabric's error and a Retry action. In both cases the last projection loaded is named as out of
     date and is not drawn, so a previous composition is never presented as the current one.
   - A section or annotation Fabric reports as `COMPILE_STALE` reads "out of date: compile again", and the old values
     are never shown silently.
   - A compile-derived answer (the compile result, the contract diff, the verification) is also pinned to the compile
     record it is about, by that record's contract hash. Every compile is a new record, so a recompile, at the same
     revision too, signed or not, by this operator or arriving through polling, makes the earlier answers out of date.
     Polling never takes a record away: a session snapshot with fewer compile records than the one held is older and
     is ignored. The deployment resolution comes from no compile and is not bound to a record.
   - A view answer (`views/*`) is pinned to what the answer itself describes, never to what was asked: its tenant,
     assembly, session and revision, and the compile record its compile-derived sections name (their provenance).
     A collaborator can edit between the request and Fabric's processing it, so an answer can describe a later
     revision than the one Studio holds. Such an answer is not drawn until the session Studio holds reaches that
     revision, and Studio refreshes the session at once to get there. An answer for another tenant, assembly or
     session is refused and named as the view's error.
   - An overlay answer (`overlays/*`) is pinned the same way as a view answer: to its tenant, assembly, session and
     revision. An overlay that reads the compile (Performance & Load, Compliance & Governance) is also pinned to the
     compile record Fabric names in its `provenance`, which Fabric sets even when nothing came of that record; an
     answer naming none is about no compile, so it is out of date once a compile is recorded. Security & Trust reads
     claims only and is never pinned to a compile, so a compile leaves its answer current. An answer for another
     overlay or scope is refused and named as the overlay's error; while an overlay's answer is loading or failed, the
     overlay reads so, and P1's Security facts stand.
   - An emit-plan answer is pinned like a compile-derived answer: to its tenant, assembly, session and revision, the
     policy Studio sent, and the compile record Fabric names in its `provenance` (none before a compile). It is also
     pinned to the environment it describes, by name and Fabric's `contentSha256` of its settings, never by revision:
     a deleted and re-created environment starts at revision 1 again. Choosing another environment, or a change to the
     chosen one's settings, makes it out of date. An answer for another environment or scope is refused. The
     runtime-binding facts in Substrate & Topology and the overlays read only the current answer.
   - A historical result (`historical: true`) appears only in the compile and history panels, labelled with its
     revision and hash.

### 4.4 Adding a domain overlay

There are no user-loaded rule packs. A rule pack that gates would be a second validation layer next to DCP, and one
loaded at runtime would be a plugin loader. Both are excluded by the platform's design. Instead:

- **Organisation-specific rules** are expressed where Fabric already enforces them: trust policy and needs.
- **A domain overlay** (for example an ISO 26262 safety overlay over faults, or a FinOps overlay over cost) is added
  as a built-in, versioned `OverlayDefinition` only once DCP carries its data. It is designed in this document first,
  with its applicability row. It annotates and never gates.

## 5. The workbench

### 5.1 Layout

One workbench replaces today's separate Studio routes.

| Region | Content |
|---|---|
| Top bar | Tenant, assembly, session, compile and sign actions |
| Subbar | **View switcher** (Flow & Composition and Substrate & Topology always present; others appear when available), **"More views"** (unavailable views with their reason), **overlay pills**, **renderer toggle** (3D / 2D / Table) |
| Palette | Catalog browsing for adding components (Flow & Composition only) |
| Stage | The active renderer for the active view, with `SemanticZoomNavigator` drill-down in every view |
| Inspector | Sections contributed by the active view and by each active overlay, for the current selection |
| Guided-fix strip | Always-on guided-fix cards |
| Status bar | Counts and revision |

The subbar replaces the five tabs at `DraftWorkspacePanel.tsx:1301` (`Assembly`, `Exploded`, `Ports`, `Substrate`,
`Validation`), which today only change scene opacity.

### 5.2 Renderer support

| View | 3D | 2D | Table |
|---|---|---|---|
| Flow & Composition | yes (assembly and exploded layouts) | yes | yes |
| Data & State | no | yes (ownership matrix) | yes |
| Substrate & Topology | yes (base plate) | yes | yes |
| Runtime & Telemetry | no | yes | yes |

The Table renderer exists for every view, because VC §20 requires every inspection and operation to be possible without
3D. The renderer toggle disables combinations that do not exist rather than falling back silently.

### 5.3 Panels that leave their routes

| Today's route | Becomes |
|---|---|
| `graph` | Flow & Composition, 2D renderer |
| `read-only` | Flow & Composition, Table renderer, opened on a supplied contract |
| `deployment-planner` | Substrate & Topology, with the planner panels in the inspector |
| `signing` | Compile panel; signing state also feeds the Security & Trust overlay |
| `audit` | Compliance & Governance overlay inspector section |
| `intents` | History panel |
| `diff` | Compile panel (contract diff, P2) |
| `workspace` | The workbench itself |
| `catalog` | Unchanged: the tenant-scoped catalog curation screen (§3.5) |
| `help` | Unchanged |

Each retired route redirects to the workbench with deep-link query parameters:
`?view=flow|data|topology|runtime&overlays=security,performance,resilience,compliance&renderer=3d|2d|table`, plus
`panel=compile|history` for a route whose target is a panel. Existing query parameters (`tenantId`, `assemblyId`,
`contractPath`, `renderer`, `policy`) keep their meaning. The current `renderer=2d|3d` parameter gains `table`.

| Retired route | Redirect |
|---|---|
| `graph` | `view=flow&renderer=2d` |
| `read-only` | `view=flow&renderer=table`, keeping `contractPath` |
| `deployment-planner` | `view=topology`, keeping `policy` |
| `signing` | `view=flow&overlays=security&panel=compile` |
| `audit` | `view=flow&overlays=compliance&panel=compile`. Until P2, the Compliance overlay is listed as unavailable with its reason, and the decision audit is in the compile panel |
| `intents` | `view=flow&panel=history` |
| `diff` | `view=flow&panel=compile`, where the contract diff compares a past compile record with the current one (P2a) |

A deep-link value outside its set is never coerced. The workbench keeps its default for that parameter and shows a
notice naming the ignored parameter and value. An unsupported combination, such as `view=data&renderer=3d`, keeps the
view and uses that view's first supported renderer, and says so in the same notice.

### 5.4 Migrating the old tabs

| Old `activeView` | New view state |
|---|---|
| `Assembly` | Flow & Composition, 3D |
| `Exploded` | Flow & Composition, 3D, exploded layout |
| `Ports` | Flow & Composition, 2D |
| `Substrate` | Substrate & Topology, 3D |
| `Validation` | Flow & Composition, 3D, guided-fix strip expanded |

### 5.5 Deployment environments

Substrate & Topology's inspector has a **Deployment Environment** card: the tenant's environments, the one chosen for
the emit plan (none until the operator chooses one; the choice is not persisted), and a **Manage environments** action
that opens the editor. The editor lists the environments, creates, edits and deletes them, and holds a structured form:
- **Target:** kind, environment, region, endpoint, an options table and credential references. The options are the
  target file's: images, and the operator's deployment inputs on the Studio server (for example `flowWorkflowsPath`,
  `foundryDeploymentRootPath`, `serviceConfigPath.<name>`), which the emit plan never invents. The inputs the emit plan
  generates itself (the contract, profile, runtime bindings, runtime bundle, hosted jars and trust keys) are reserved,
  and Fabric refuses an environment that names them;
- **Runtime bindings:** service base URLs by provider claim URI, runtime timeout, telemetry namespace;
- **Identity:** off by default; when on, issuer, audiences by service, the tenant, roles and permissions claims, and the
  token endpoint, verification keys, client credentials and per-service credentials references;
- **Hosted components:** configuration entries; **Documentation:** default visibility, the visibility file's text and
  the observation intervals; **Disabled bindings.**

The form holds references only. Studio checks nothing itself: Fabric checks each save, and its problems are shown next
to the field their path names. A save against an older revision is Fabric's `409 ENVIRONMENT_REVISION_CONFLICT`, shown
as a conflict with the current revision and a reload action, never retried. A delete names the revision it expects in the
same way.

The **Emit Plan** card shows the current answer for the chosen environment: target kind, artifacts with "preview hash",
the secret requests by name, bound component and store hint, and the bindings' count, or Fabric's code and message.
With no environment chosen it says so. An out-of-date answer names why (§4.3 rule 6) and shows no values.

## 6. View state

```ts
/** View state only (VC §24): never sent in an intent, never part of composition state. */
type StudioViewState = {
  view: "FLOW" | "DATA" | "TOPOLOGY" | "RUNTIME";
  overlays: readonly ("SECURITY" | "PERFORMANCE" | "RESILIENCE" | "COMPLIANCE")[];
  colourOverlay?: "SECURITY" | "PERFORMANCE" | "RESILIENCE" | "COMPLIANCE";
  renderer: "THREE_D" | "TWO_D" | "TABLE";
  layout?: "ASSEMBLY" | "EXPLODED";          // 3D Flow only
  semanticZoomLevel: "PARENT_DCP" | "ASSEMBLY_DCP" | "CHILD_DCP";
  selectedSurface: string;
};
```

`StudioLayoutState` (`packages/fabric-validation-client/src/index.ts:308`, mirrored by the Fabric `StudioLayoutState`
record) gains `activeViewpoint`, `activeOverlays`, `colourOverlay`, `renderer` and `layout`.

- `activeView` is kept for reading old layouts only. A layout that has `activeView` and no `activeViewpoint` is mapped
  with §5.4.
- Writes always send the new fields.
- Layout stays keyed by tenant, user and assembly (VC §2A rule 4), and remains "UI state ... not ... a contract validity
  source" (Fabric Studio API, Layout).

A starter preset (VC §19A) may set the initial `StudioViewState`. That is the only thing a preset may set here.

## 7. Architecture for the implementation

These patterns are named so the code can carry them in its header comments (engineering rule 5).

| Piece | Pattern | Responsibility |
|---|---|---|
| `ViewDefinition` registry | Registry + Strategy | One definition per view: `id`, `isAvailable(data) → {available, absentReason}`, supported renderers, inspector sections. The switcher and "More views" are built from it. |
| `OverlayDefinition` | Decorator | `appliesTo` views, `isAvailable(view, data)`, `decorate(element) → annotations` (badges, colour, inspector section, table columns). It cannot return new elements. |
| Per-view projectors | Projector | Typed Fabric view data → renderer-neutral view model (nodes, edges, rows). Renderers consume only this model. A draft's projectors start from `DynamicDcpProjectionResponse`, the draft session's projection, not from a compiled `ReadOnlyCompositionView`, so 3D, 2D and Table draw the same draft. The `read-only` deep link projects a supplied contract's `ReadOnlyCompositionView` into the same model. |
| Renderers | Strategy | 3D (`ThreeAssemblyScene`), 2D (`graphView.ts` / `GraphPanel`), Table (`tableView.ts` / `TablePanel`), each over the projector's model. |
| Workbench store | Reducer (state machine) | Replaces the ad-hoc `useState` hooks in `DraftWorkspacePanel.tsx` with composition state (from Fabric) and view state (§6) kept apart. |

**Reuse rather than rewrite:**
- `SemanticZoomNavigator` (drill-down in every view);
- the deployment-planner panels (`SelectedShapesPanel`, `RejectedShapesPanel`, `IsolationMatchesPanel`,
  `FallbackAttemptsPanel`, `RequiredPortsPanel`);
- `decisionAuditView`, `signingHandoff`, `draftOverlays`, `sessionReconciliation`, `intentHistory`;
- `fabric-validation-client` for every call.

**Studio never parses `catalogManifest`.** Claim interpretation belongs to Fabric through the `unfurl-dcp` model, and
every P2 field arrives through the typed endpoints.

## 8. Conformance fixes this design requires

The redesign removes current behaviour that breaks engineering rule 2:

1. `inspectorDetailsFor` in `DraftWorkspacePanel.tsx` (around line 3042) hard-codes `bindingMode: "DYNAMIC"`,
   `substrateTarget: "Customer Runtime Substrate"` and `isolationPattern: "POLICY"`, and always returns empty required
   ports. The inspector shows only values Fabric supplies. An absent value is marked "not provided by Fabric".
2. The stage toolbar's buttons that perform no action are removed. A control appears only when it has a working
   behaviour.
3. The palette's unwired Components/Substrate tabs, search and filter are either wired to the catalog or removed.
4. The inspector tabs (Properties, Bindings, Diagnostics, Audit), which never switch content, are replaced by sections
   contributed by views and overlays (§7).
5. The demo fallbacks switched by `VITE_STUDIO_DEMO_FALLBACKS` are removed: the hard-coded sample assembly, the generated
   catalog, local replacement options and the static palette groups. So are the fixed top-bar texts ("Fabric synced",
   a fixed user avatar) and the fixed "profile mode: STRICT". Offline previews use only the explicit, labelled fixture
   mode (`StudioClientProvider mode="fixture"`). The sync state shown is the session reconciliation state, and the
   profile mode appears only when Fabric supplies it.
6. Presence and the per-user layout copy use the host's verified operator id (`UnfurlMicroAppProps.user.id`, through
   `StudioClientProvider operatorId`), never a fixed "Local Operator". Without a host identity there is no presence.
7. The guided tour is removed. It drove the stage by selecting a fabricated sample component, and its region
   explanations are on the help route, which remains.

## 9. Tests

1. Every view and overlay has a fixture with its data and a fixture without it. The second must show the unavailable
   state with its reason, never an empty layer or a default.
2. Renderer parity: for each view, Table and 2D render the same elements.
3. Overlays never change intents. Toggling every overlay on every view produces no intent, no composition-state change
   and no revision change.
4. Layout migration: each old `activeView` value maps as in §5.4, and writes carry only the new fields.
5. Deep links and redirects: each retired route lands on the workbench with the mapped view state (Playwright, extending
   `scripts/verify-host-runtime.mjs`).
6. Security & Trust is tested both with an `identity-context` provider in the composition and without it (engineering
   rule 6), in Fabric and in Studio. With it, the authentication and authorization ports read "enforced". Without it,
   they read "trusted network" and the identity finding says identity is not in the composition.
7. Rule-2 regressions: the inspector renders no literal binding mode, substrate target or isolation pattern that did
   not come from Fabric.
8. Compile records (P2a):
   - the contract diff and the verification render Fabric's answer only while current, labelled current or
     historical, and show Fabric's absent reason otherwise;
   - an answer asked for another revision or policy, or about a compile record a later compile replaced, reads as
     out of date;
   - a polled session with fewer compile records than the one held is ignored;
9. Typed views (P2b):
   - Data & State and Runtime & Telemetry with data are offered, and without it are under "More views" with Fabric's
     reasons;
   - the ownership matrix and the Table draw the same elements;
   - external owners, external-protocol facts and transports appear only from Fabric's data;
   - view data from before a recompile is not drawn.
   - the verification reaches Security & Trust only while current;
   - a `NO_MATCH` gives one guided-fix card per typed cause and trust rejection;
   - the client sends the policy as JSON for Fabric to hash.
10. Overlays (P2c):
   - Performance & Load and Compliance & Governance read "loading" until Fabric answers, Fabric's reason when it has no
     data, and Fabric's annotations and findings only while current;
   - a Compliance answer that names no compile is not drawn once a compile is recorded;
   - a compile leaves Security & Trust's claim-only annotations current;
   - a compile-reading overlay is pinned to the record Fabric names even when nothing came of it
     (`NO_TIMEOUTS_DECLARED` shows Fabric's reason, not "loading"), and a later compile makes it out of date;
   - an overlay whose annotations all fall outside the active view is unavailable with `NOTHING_IN_VIEW`;
   - an answer for another session is refused, and one for a later revision is held back until the session reaches it;
   - Security & Trust adds Fabric's port annotations in both identity paths, and keeps P1's facts while loading.
11. Emit plan and environments (P2d):
   - the emit-plan answer is refused for another environment or scope, and is out of date after choosing another
     environment, after the chosen one's settings change (also when it is deleted and re-created at the same revision),
     and after a new compile record;
   - the Emit Plan card shows the plan, Fabric's reason, or that no environment is chosen, and a secret request never
     shows a value;
   - runtime-binding facts, runtime timeouts, audit flags and secret-request names appear only while the answer is
     current;
   - the editor converts between the form and Fabric's environment, shows Fabric's problems by field path, and shows a
     revision conflict as a conflict;
   - the client keeps Fabric's error body (problems, current revision) and reads a 204 as no body.
12. Resilience & Faults (P2e):
   - it reads "loading" until Fabric answers, Fabric's reason (`NO_FAULTS_DECLARED`) without faults, and Fabric's
     annotations and findings while current; a compile never makes it out of date;
   - a fault on a node and its propagation on the `CONTAINS` edge survive the guard in Flow & Composition, and an
     edge annotation is dropped in a view that does not draw that edge;
   - the 2D renderer draws the annotated edge as a path, styled by its most severe annotation, with a title.

## 10. Phasing

- **P1: data available today.**
  - The workbench shell, view state, layout migration and redirects.
  - Flow & Composition (except typed external owners and `external_protocol`).
  - Substrate & Topology (base plate, shapes, resolution, target).
  - Security & Trust: identity in the composition (a provider of `identity-context`), trust policy id, signing state,
    and Fabric's `TRUST_POLICY_PERMISSIVE` warning. The signing state follows §4.3 rule 6. Studio pins each compile and
    resolution response to the session id, revision and deployment policy it was produced with, and reports it out of
    date as soon as any of them differs (P2a adds Fabric's own compile records for the contract diff and verification). Only a response produced by that
    request is pinned; a failed compile never re-pins an earlier one.
  - Loading an assembly snapshot restores the snapshot's layout through the same mapping as any stored layout
    (§5.4, §6), so the imported view state is shown and then saved, never overwritten by the previous one. A
    snapshot without a session clears the open session and its inventory (§4.3 rule 6).
  - The guided-fix strip.
  - The §8 conformance fixes.
- **P2: after the Fabric view and overlay endpoints.** Built in slices, each on the compile records of P2a.
  - **P2a, implemented: compile records, contract diff, verification, typed match failures.**
    - Fabric records every successful compile and keeps the compiled bytes; Studio pins a compile to the record
      Fabric returns (LLD-fabric-studio-api, *Compile records and freshness*).
    - The compile panel compares a past record with the current one, and verifies the current compile with
      Fabric's trust keys. Each answer is Fabric's, including whether it is current; Studio sends its policy draft
      and never hashes it. An answer is shown only while it matches the session, revision and policy it was asked
      with, a historical one is labelled with its revision and hash, and an unavailable one shows Fabric's code and
      message (`COMPILE_REQUIRED`, `COMPILE_STALE`, `COMPILE_RECORD_UNAVAILABLE`, `COMPILE_RECORD_INCONSISTENT`,
      `NOT_SIGNED`, `TRUST_KEYS_UNAVAILABLE`). Each answer is pinned to the compile record it is about (§4.3 rule 6).
    - The guided-fix strip shows a `NO_MATCH` as one card per typed cause and trust rejection, in Fabric's words; it
      never splits `details`.
    - Security & Trust adds the verification while it is current, and shows a named trust policy as named, not as
      enforced: Fabric does not apply named trust policies yet (LLD-fabric-studio-api, *Gap: a session's trust
      policy is not applied*).
    - Studio still compares its own policy drafts locally (`policyKey`) to tell when a response it holds no longer
      matches its inputs. The deployment resolution has no Fabric record, so this is the only way to know it is out
      of date. That comparison never produces a hash for Fabric and is never compared with one.
  - **P2b, implemented: the typed views (`views/*`).**
    - Studio loads all four views for the current session, revision, policy and compile record, and pins each answer
      to those inputs (§4.3 rule 6), so an out-of-date view is never drawn.
    - Data & State and Runtime & Telemetry are offered only while one of their sections has data, and are otherwise
      under "More views" with Fabric's reasons.
    - Flow & Composition adds external owners and `external_protocol` facts; Substrate & Topology adds transports.
    - Runtime bindings moved to P2d, where the emit plan generates them.
  - **P2c, implemented: the perspective overlays (`overlays/*`).**
    - Studio loads Security & Trust, Performance & Load and Compliance & Governance for the active view and the
      current inputs, and pins each answer like a view answer (§4.3 rule 6).
    - Security & Trust adds each node's declared authentication and authorization, "enforced" or "trusted network"
      by whether identity is in the composition. Flow, Foundry and the API catalog declare both ports, not required,
      and enforce them only when `identity-context` is in the contract.
    - Performance & Load shows the contract timeouts; Compliance & Governance the trust-policy provenance, the
      decision audit and the audit-event emitters. Both are unavailable with Fabric's reason when they have no data.
    - The runtime `timeout_ms` override and `audit_enabled` moved to P2d with the runtime bindings.
  - **P2d, implemented: deployment environments and the emit plan.**
    - The tenant's deployment environments are Fabric's, edited in Substrate & Topology (§5.5). Studio checks nothing:
      Fabric checks each save and names every problem by field path.
    - For the chosen environment Studio loads the emit plan of the current compile and pins it (§4.3 rule 6). The Emit
      Plan card shows it, and the bindings it generated become facts on their provider nodes.
    - Performance & Load adds each binding's runtime timeout; Compliance & Governance its audit flag; Security & Trust
      the secret requests and Fabric's "Identity in the needs" finding.
  - **P2e, implemented: Resilience & Faults (`overlays/resilience`).**
    - DCP divergence #5 is resolved: the `dcp` fault schema, spec and examples follow HLD-C2 A.10, which the Java
      model and every product claim already did.
    - Studio loads Resilience & Faults like the other Fabric overlays. It reads claims only, so it is never pinned to a
      compile. Each declared fault is a badge on its component, and a propagating fault's path is drawn on the
      `CONTAINS` edge to its parent and on the parent. Without declared faults it is unavailable with Fabric's
      `NO_FAULTS_DECLARED`.
- **P3: after DCP schema work.**
  - Concurrency semantics, resource budgets and load envelopes.
  - Residency.
- **Later: after the performance-verification design.**
  - Test-deployment telemetry and bottleneck evidence.
