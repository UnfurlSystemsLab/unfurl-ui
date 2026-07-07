# LLD - Unfurl Studio Visual Composition Surface

**Document status:** Draft low-level design.
**Position in the portfolio:** This document is the detailed design for the **Fabric Studio webapp** introduced in `HLD-D-fabric-ui-host-shell.md`. HLD-D owns the host-shell architecture: single-spa, mounted webapps, themes, routing, security, and compatibility. This LLD owns the Studio-specific implementation surface: visual manifests, optional 3D assets, scene graph, port handles, substrate base plate, validation intents, and export workflow.
**Architectural stance:** 3D assets are not decoration. They are first-class visual projections of DCP and Fabric metadata. The visual graph is never the source of truth.

---

## 1. Purpose

Unfurl Studio is the interactive design-time UI for Fabric.

Fabric already works as a CLI/compiler:

```text
catalog + needs + trust policy -> match -> compile -> sign -> deploy to flow
```

Unfurl Studio gives operators the same governed workflow as a visual composition surface:

```text
catalog components -> 3D workspace -> validated intents -> contract + substrate profile
```

The goal is not to create a standalone "3D visualizer." The goal is to make Fabric's composition model inspectable, manipulatable, and explainable while preserving all DCP/Fabric governance.

Operators can use:

- `unfurl-fabric` for automation and CI.
- `unfurl-studio` for interactive visual composition and inspection.
- `unfurl-flow` for runtime execution.

---

## 2. Core principle

The visual scene is a projection of Fabric state:

```text
DCP/Fabric model -> Studio scene model -> 3D rendering
```

Not:

```text
3D rendering -> implicit contract
```

The source of truth remains:

- Catalog claims
- Needs
- Trust policy
- Match results
- CompositionContract
- SubstrateProfile

The visual manifest decides how truth is displayed. It does not decide whether a composition is valid.

Whenever an operator manipulates the scene, Studio sends an **intent** to Fabric. Fabric validates the intent against DCP, trust policy, matcher state, candidate validity, and substrate derivation. Studio updates the scene only from Fabric's response.

Rule:

> User manipulates shapes. Fabric validates intents. DCP decides compatibility. Studio renders the result.

---

## 2A. Tenant and assembly scope

Studio is designed as a multitenant system. A tenant is the isolation boundary
for catalog entries, visual assets, needs, trust policy, deployment policy,
draft sessions, compiled contracts, substrate profiles, audit history, and
saved layout metadata.

A tenant can own multiple assemblies. An assembly is the durable design-time
workspace for one target application or solution. Each assembly may have many
draft sessions, extracted needs, deployment defaults, saved layouts, compiled
contracts, and substrate profiles.

Rules:

1. Every Studio/Fabric API request is scoped by tenant and assembly, either
   through authenticated context or explicit `tenantId` / `assemblyId` fields.
2. Candidate matching, replacement suggestions, visual assets, and deployment
   policy resolution must not cross tenant boundaries.
3. A component can be visible in multiple tenant catalogs, but each tenant's
   trust decision, deployment policy, and assembly state remain separate.
4. Layout-only browser state should be keyed by tenant, user, and assembly so
   one assembly's camera, placement, annotations, or tutorial progress does not
   leak into another assembly.
5. Compile/export operates on the current validated assembly revision, not on
   global UI state.

For local MVP fixture mode, Studio may use a synthetic tenant and assembly such
as `tenant-local` and `assembly-demo`, but DTOs and storage keys should preserve
the shape so production multitenancy does not require a model rewrite.

---

## 2B. Dynamic composite DCP interpretation

Studio is the visual operator surface for DCP's dynamic composite model. DCP is
not a fixed hierarchy where a company always contains one substrate, one module
layer, and one component layer. A DCP can contain descendant DCPs at several
levels, and those descendants can be selected, replaced, enabled, disabled, or
rebound based on tenant, policy, deployment environment, runtime context, and
requested capabilities.

Example:

```text
Tenant A -> Azure substrate + Keycloak + Azure Blob + Azure OpenAI
Tenant B -> AWS substrate + Auth0 + S3 + Bedrock
Tenant C -> private substrate + Keycloak + MinIO + Local Model Gateway
```

Studio should make that late-bound composition visible:

- Dynamic discovery appears as the catalog and compatible-alternatives palette.
- Dynamic selection appears as candidate choice, replacement, and policy
  preference.
- Dynamic validation appears as connection status, rejection reasons, and
  compatibility reports.
- Dynamic binding appears as validated pipes, substrate ports, and deployment
  bindings.

This is why taking out a component, replacing it with an outer/alternative
component, or rebinding a pipe is a first-class Studio workflow. The visual move
is only an operator intent; DCP/Fabric decide whether the dynamic composition is
still valid.

Hard rule:

> Studio edits the dynamic composition through validated intents. It never
> mutates the composition by rewriting the rendered scene.

---

## 3. Component artifact layout

Each Intelligent Component JAR can carry:

```text
META-INF/
  unfurl-catalog.yaml       # DCP claim + catalog metadata
  unfurl-visual.yaml        # visual manifest

META-INF/visual/
  component.glb             # optional rich 3D model
  thumbnail.png             # optional palette thumbnail
```

`unfurl-catalog.yaml` is truth:

- Claim identity
- Offers
- Dependencies
- Refusals
- Capability versions
- Lifecycle
- Artifact coordinates
- Binding metadata

`unfurl-visual.yaml` is rendering metadata:

- Model path
- Fallback shape
- Port anchors
- Connector shapes
- Interaction hints
- Category and color hints

If a custom GLB is missing, Studio uses generated fallback shapes. Component authors should not need 3D artists to participate.

---

## 4. Visual Component Manifest

The Visual Component Manifest declares how a component appears in Studio.

Example:

```yaml
visual:
  model:
    type: GLB
    path: META-INF/visual/storage-s3.glb

  shape:
    fallback: CUBE
    category: STORAGE
    colorHint: storage
    size: MEDIUM

  ports:
    - id: storage-put
      capability: storage.put
      kind: OFFER
      anchor: right-upper
      connectorShape: SQUARE_SOCKET

    - id: storage-get
      capability: storage.get
      kind: OFFER
      anchor: right-lower
      connectorShape: SQUARE_SOCKET

    - id: secrets-provider
      capability: secrets.provider
      kind: SUBSTRATE_DEPENDENCY
      anchor: bottom-left
      connectorShape: HEX_SOCKET

  interactions:
    draggable: true
    connectable: true
    inspectable: true
    removable: true
```

The manifest may live as a separate `META-INF/unfurl-visual.yaml` file or, if the catalog schema later chooses consolidation, under the `catalog.visual` block. The separate-file form is preferred initially because it keeps DCP/catalog truth visually decoupled from UI rendering metadata.

---

## 5. DCP truth vs visual metadata

The split is strict:

| Concern | Owner |
|---|---|
| Offers | DCP claim |
| Dependencies | DCP claim |
| Refusals | DCP claim |
| Capability versions | DCP claim |
| Compatibility | Fabric/DCP matcher and validator |
| Trust classification | Fabric trust policy |
| Substrate requirements | Fabric substrate derivation |
| Port placement | Visual manifest |
| Connector shape | Visual manifest |
| Fallback 3D shape | Visual manifest |
| Custom model path | Visual manifest |
| Interaction handles | Visual manifest |

A visual port must reference a real DCP capability, dependency, substrate dependency, or refusal concern. Studio may render missing visual ports with generated anchors, but it must not invent semantic ports that DCP does not declare.

---

## 6. Catalog loading

When Fabric scans a catalog for Studio, it discovers:

1. DCP claim and catalog metadata from `META-INF/unfurl-catalog.yaml`
2. Visual manifest from `META-INF/unfurl-visual.yaml`, if present
3. Optional 3D model and thumbnail assets from `META-INF/visual/`

The resulting catalog metadata supports the Studio palette:

```text
Storage
  - S3 Storage Component
  - Azure Blob Storage Component
  - PostgreSQL Storage Component

Authentication
  - Keycloak Component
  - Customer OIDC Component

AI
  - Azure OpenAI Component
  - Ollama Component
  - Gemini Component
```

The palette is driven by catalog entries, visual categories, and DCP capabilities. Studio does not hardcode every component shape.

---

## 7. Workspace interaction model

Studio supports:

- Drag component into workspace
- Move component
- Rotate component
- Inspect component
- Connect ports with pipes
- Disconnect pipes
- Remove component from draft
- Replace one component with another
- Hide or show substrate layer
- Run compatibility check
- Freeze contract
- Export contract and substrate profile

Example flow:

```text
User drags S3 Storage component
  -> Studio shows storage.put and storage.get offer ports
  -> Studio shows secrets.provider as a required bottom connector
  -> Substrate base plate lights up secrets.provider
  -> User connects audit.write to an Audit component
  -> Studio sends CONNECT intent to Fabric
  -> Fabric validates the composition
  -> Studio updates status rings, pipes, warnings, and required substrate ports
```

Interaction is optimistic only at the gesture level. Semantic state is accepted only after Fabric validates it.

---

## 8. Ports as physical handles

Ports are physical handles on the 3D component.

Each visual port can carry:

- Connector shape
- Direction
- Compatibility glow
- Drag handle
- Status ring
- Tooltip

Port state examples:

| State | Visual treatment |
|---|---|
| Unconnected required dependency | Red hollow socket |
| Connected valid dependency | Green locked pipe |
| Optional available connection | Yellow glow |
| Invalid attempted connection | Red flash + reason |
| Substrate-required port | Bottom pipe to base plate |
| Refusal redirect | Capped connector with arrow |

The UI should make the DCP model visible:

- Offers appear as available outward handles.
- Dependencies appear as required inward sockets.
- Substrate dependencies route downward to the base plate.
- Refusals appear as capped, redirected responsibilities.

---

## 9. Substrate as base plate

The substrate appears as a base layer under the components.

When a component requires substrate capabilities such as:

```text
secrets.provider
telemetry.otel
ai.llm.azure-openai
storage.blob
```

Studio renders a pipe from the component down into the substrate base plate.

Substrate socket states:

| State | Meaning |
|---|---|
| Active substrate port | Required by the current composition and compatible |
| Available but unused | Offered by runtime, absent from SubstrateProfile |
| Missing required port | Required by profile, absent from runtime claim |
| Blocked by policy | Runtime offers it, but policy forbids activation |

This visually communicates the closed-world runtime rule:

> Flow initializes only ports listed in the SubstrateProfile. Other available ports stay dark.

---

## 10. Scene model

Studio builds an internal scene graph from Fabric metadata.

Example TypeScript shape:

```ts
type VisualComponent = {
  id: string;
  catalogEntryId: string;
  name: string;
  category: "STORAGE" | "AUTH" | "AI" | "AUDIT" | "WORKFLOW";
  modelUrl?: string;
  fallbackShape: "CUBE" | "SPHERE" | "CYLINDER" | "SHIELD" | "GEAR";
  position: [number, number, number];
  rotation: [number, number, number];
  ports: VisualPort[];
};

type VisualPort = {
  id: string;
  capability: string;
  kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL";
  anchor: string;
  connectorShape: "ROUND" | "SQUARE" | "HEX" | "PIPE" | "LOCK";
  status: "AVAILABLE" | "CONNECTED" | "MISSING" | "INVALID" | "INACTIVE";
};
```

The scene graph is not serialized as the contract. It is a UI projection and may contain layout-only fields such as position and rotation.

---

## 11. Intent protocol

All user manipulation becomes Fabric intents.

Examples:

```json
{
  "type": "ADD_COMPONENT",
  "catalogEntryId": "com.unfurl:unfurl-storage-s3:1.2.0"
}
```

```json
{
  "type": "CONNECT",
  "fromPort": "storage-s3.storage.put",
  "toPort": "workflow.storage.required"
}
```

```json
{
  "type": "DISCONNECT",
  "pipeId": "pipe-123"
}
```

```json
{
  "type": "REMOVE_COMPONENT",
  "componentId": "storage-s3",
  "catalogEntryId": "com.unfurl:unfurl-storage-s3:1.2.0"
}
```

```json
{
  "type": "REPLACE_COMPONENT",
  "oldComponentId": "storage-s3",
  "oldCatalogEntryId": "com.unfurl:unfurl-storage-s3:1.2.0",
  "newCatalogEntryId": "com.unfurl:unfurl-storage-blob:1.1.0"
}
```

Fabric responds with validated state:

```json
{
  "status": "VALID",
  "updatedCandidateId": "cand-abc123",
  "requiredSubstratePorts": [
    "secrets.provider",
    "storage.blob",
    "telemetry.otel"
  ],
  "warnings": []
}
```

or:

```json
{
  "status": "INVALID",
  "reason": "Capability version conflict",
  "details": "storage.put@2.0.0 cannot satisfy storage.put@^1"
}
```

The intent API is the primary boundary between Studio and Fabric engine. Studio never bypasses it to generate a contract directly.

---

## 12. Backend responsibilities

`unfurl-fabric` exposes or supports:

- Scan catalog
- Expose component metadata
- Expose visual manifests and model asset URLs
- Validate visual connection intents
- Plan composition
- Explain rejection
- Compile contract
- Derive substrate profile
- Sign or prepare for signing

Studio should call Fabric through an explicit API surface rather than reimplement matcher logic in TypeScript.

Fabric remains the authority for:

- DCP matching
- Version compatibility
- Trust policy
- Candidate validation
- Refusal alignment
- Scoring
- Substrate derivation
- Contract compilation

---

## 13. Frontend responsibilities

Recommended frontend stack:

- React
- TypeScript
- React Three Fiber
- Three.js
- Zustand or Redux

Studio owns:

- Catalog palette
- Visual manifest loading
- Scene graph builder
- 3D renderer
- Interaction controller
- Fabric validation client
- Contract/profile export UI
- Inspector panels
- Advisor interaction surface

Studio does not own:

- DCP compatibility
- Trust policy decisions
- Match validity
- Substrate compatibility semantics
- Contract signing semantics

---

## 14. Suggested repository shape

Initial implementation should live inside the UI monorepo described by
`HLD-D-fabric-ui-host-shell.md`:

```text
unfurl-ui/
  apps/
    fabric-studio-webapp/
      src/
        catalog/
          CatalogClient.ts
          VisualManifestClient.ts
        scene/
          SceneGraphBuilder.ts
          sceneTypes.ts
          anchors.ts
        renderer/
          ComponentMesh.tsx
          PortHandle.tsx
          Pipe.tsx
          SubstrateBasePlate.tsx
        interaction/
          DragController.ts
          ConnectController.ts
          IntentDispatcher.ts
        fabric/
          FabricValidationClient.ts
          FabricExportClient.ts
          intentTypes.ts
        inspector/
          ComponentInspector.tsx
          PortInspector.tsx
          DecisionAuditPanel.tsx
        advisor/
          AdvisorPanel.tsx

  packages/
    visual-manifest/
    fabric-scene-model/
    fabric-validation-client/
    three-renderer/
    graph-layout/
```

Backend support can remain in `unfurl-fabric` initially:

```text
unfurl-fabric/
  studio/
    VisualManifestCodec
    VisualCatalogEntry
    StudioIntentValidator
    StudioSceneProjection
```

If the surface grows large, split a pure `unfurl-studio-api` module later for shared DTOs.

The product name is **Unfurl Studio**. A standalone `unfurl-studio` repository
can be split out later if product ownership, deployment, or marketplace
distribution requires it.

---

## 15. Fallback shape system

Do not require custom 3D models.

Level 1: generated shapes

```yaml
visual:
  shape:
    fallback: CUBE
    category: STORAGE
```

Studio generates a standard component mesh from category, fallback shape, color hint, and port anchors.

Level 2: custom 3D model

```yaml
visual:
  model:
    type: GLB
    path: META-INF/visual/storage-s3.glb
```

Studio loads the GLB and overlays Fabric/DCP port handles at declared anchors.

If model loading fails, Studio falls back to generated shapes and surfaces a non-blocking warning.

---

## 16. Validation and governance rules

Studio must enforce these rules structurally:

1. Visual graph is not source of truth.
2. Every semantic manipulation is an intent.
3. Fabric validates every intent.
4. DCP decides compatibility.
5. Trust policy remains a gate.
6. Refusals remain visible and enforced.
7. Substrate derivation remains deps-first.
8. Closed-world substrate ports are displayed and enforced.
9. No design-time secret values appear in scene state, visual manifests, or exported profiles.
10. Contract export uses Fabric compiler output, not UI-derived graph serialization.

Invalid connection attempts should be explainable:

```text
Invalid: storage.put@2.0.0 cannot satisfy requested storage.put@^1.
Invalid: selected component refuses identity-management and no owner is present.
Invalid: secrets.provider is required but the selected substrate claim does not offer it.
```

---

## 17. Product positioning

Recommended product name:

```text
Unfurl Studio
```

Rationale:

- "Studio" fits design-time composition.
- "Cockpit" is better reserved for runtime operations and monitoring.
- "Workbench" is accurate but less product-shaped.

The product line becomes:

| Product | Role |
|---|---|
| `unfurl-fabric` | CLI/compiler for deterministic composition |
| `unfurl-studio` | Visual Fabric UI for interactive governed composition |
| `unfurl-flow` | Runtime execution engine |
| `unfurl-substrate` | Runtime surface and compatibility layer |

Positioning statement:

> Fabric can be used through CLI for automation, or through Unfurl Studio for interactive visual composition.

This turns Unfurl from YAML-based component composition into interactive governed enterprise assembly.

---

## 18. Relationship to existing docs

This document complements:

- `00-product-architecture.md`: product topology, residency wedge, design-time/runtime split
- `HLD-D-fabric-ui-host-shell.md`: frontend host-shell and single-spa mechanics
- `REPO-unfurl-fabric-build-spec.md`: Fabric compiler implementation plan
- `research/Docs/use/readme.md`: operator-facing guide
- `research/Docs/use/advisor.md`: AI advisor provider details

Open implementation question:

Should `unfurl-visual.yaml` become a separate pure schema module, or stay inside `unfurl-fabric` until Studio becomes a concrete repository? The recommended first step is to keep it in Fabric, then extract only when multiple producers/consumers exist.

---

## 19. Non-goals

Unfurl Studio is not:

- A free-form diagramming tool
- A contract generator independent of Fabric
- A runtime source of truth
- A replacement for DCP
- A bypass around trust policy
- A place to store secrets
- A requirement that every component author provide a custom 3D model

It is a visual, governed design-time projection of Fabric.

---

## 20. Accessibility and alternate views

Studio must support three synchronized views:

1. **3D Assembly View** - visual spatial composition.
2. **2D Graph View** - large-graph and keyboard-friendly graph inspection.
3. **Contract/Table View** - accessible tabular view of components, ports,
   dependencies, refusals, substrate requirements, warnings, and validation
   results.

All semantic operations available in 3D must also be possible through
keyboard-accessible controls. The 3D renderer is an affordance, not the only
way to inspect or operate the composition.

The table view should expose at minimum:

| Table | Rows |
|---|---|
| Components | selected entries, coordinates, lifecycle, trust status |
| Ports | offers, dependencies, substrate dependencies, refusals |
| Connections | source port, target port, validation status |
| Substrate | required ports, available ports, missing ports |
| Warnings | planning warnings, trust rejections, compatibility failures |

---

## 21. Large catalog performance

Studio must not render the entire catalog as a 3D scene.

The catalog palette is search/list/filter based. Studio renders only:

- active composition
- currently selected candidates
- immediate compatible alternatives
- substrate ports relevant to the current profile

Large catalogs must use lazy loading, asset caching, and model instancing where
possible. A catalog with hundreds or thousands of components should remain
usable because only the working set enters the scene graph.

Performance rules:

1. Load visual manifests lazily as entries enter the palette viewport or
   candidate set.
2. Load GLB assets only when a component is rendered in a scene.
3. Reuse generated meshes per fallback shape/category.
4. Prefer instanced rendering for repeated fallback shapes.
5. Keep catalog search/filter state outside the 3D scene graph.

---

## 22. Visual asset trust and integrity

Studio must load GLB and thumbnail assets only through Fabric-provided signed or
hash-pinned asset URLs. Studio must not directly open arbitrary paths from a
JAR.

Fabric validates the visual manifest and asset hashes before exposing URLs. If
an asset hash does not match, Studio falls back to a generated shape and records
a warning.

The visual manifest and visual assets should be included in catalog scan output
and hash-covered:

```yaml
visualIntegrity:
  visualManifestHash: sha256:...
  assets:
    - path: META-INF/visual/component.glb
      sha256: sha256:...
    - path: META-INF/visual/thumbnail.png
      sha256: sha256:...
```

Fabric exposes this as part of `VisualCatalogEntry`:

```ts
type VisualCatalogEntry = {
  catalogEntryId: string;
  claimHash: string;
  artifactSha256: string;
  visualManifestHash?: string;
  visualManifest?: VisualManifest;
  assets: VisualAsset[];
  warnings: VisualWarning[];
};

type VisualAsset = {
  assetId: string;
  path: string;
  mediaType: string;
  sha256: string;
  url: string;
};
```

Frontend trust boundary:

- Studio trusts Fabric-provided asset URLs.
- Studio does not trust manifest paths by themselves.
- Studio treats asset-load failure as non-fatal.
- Studio displays visual integrity warnings in the inspector.

---

## 23. Draft session and revision model

Studio needs a named draft composition session. Intents apply to a session, not
to global UI state.

```ts
type StudioDraftSession = {
  tenantId: string;
  assemblyId: string;
  sessionId: string;
  baseCatalogHash: string;
  needsId?: string;
  trustPolicyId?: string;
  currentCandidateId?: string;
  sceneRevision: number;
  warnings: PlanningWarning[];
};
```

The session model supports:

- multiple users or browser tabs
- multiple assemblies per tenant
- ordered intents
- stale response rejection
- candidate state versioning
- undo/redo
- deterministic compile/export from the current validated revision

Every semantic intent includes the session and base revision:

```json
{
  "tenantId": "tenant-payments",
  "assemblyId": "assembly-checkout",
  "sessionId": "studio-session-123",
  "baseRevision": 7,
  "type": "CONNECT",
  "fromPort": "storage-s3.storage.put",
  "toPort": "workflow.storage.required"
}
```

Valid response:

```json
{
  "status": "VALID",
  "newRevision": 8,
  "updatedCandidateId": "cand-abc123"
}
```

Stale response:

```json
{
  "status": "STALE_REVISION",
  "expectedRevision": 9,
  "receivedRevision": 7
}
```

Studio must reject stale responses and refresh the session before applying
further semantic edits.

`tenantId` and `assemblyId` are not cosmetic metadata. Fabric must reject an
intent when the session, catalog, needs, trust policy, deployment policy, or
current candidate belongs to a different tenant or assembly.

---

## 24. View state vs composition state

Composition state comes from Fabric:

- selected components
- selected candidate
- validated connections
- required substrate ports
- trust status
- planning warnings
- validation results

View state is local or per-user:

- camera position
- component layout
- grouping
- annotations
- collapsed panels
- selected inspector tab
- palette filters

View state is also tenant/assembly scoped. A saved placement or annotation from
one assembly must not appear in another assembly unless the operator explicitly
copies it.

Only composition state participates in compile/export. View state may be saved
as Studio layout metadata, but it must never be treated as a contract source.

When Fabric returns a dynamic DCP projection that contains broader catalog or
candidate read-model nodes, Studio must adapt that projection before rendering
assembly-specific surfaces. The 3D assembly, semantic zoom navigator, hierarchy,
and table display only CHILD nodes whose `catalogEntryId` is present in the
current draft session inventory, while retaining the real parent and assembly
DCP context. Empty drafts therefore render as an empty governed assembly even if
the projection endpoint can also describe available catalog components.

---

## 25. Undo/redo over validated intents

Undo/redo operates over the validated intent history, not arbitrary scene
snapshots.

Rules:

1. An intent enters history only after Fabric validates it.
2. Undo either applies a Fabric-supported reverse intent or rewinds to a prior
   validated revision.
3. Redo reapplies a previously validated intent against the current expected
   revision.
4. Undo/redo must preserve DCP/Fabric governance and must not resurrect invalid
   scene snapshots.

This is necessary because the scene graph contains both composition state and
layout-only state. Restoring an old scene snapshot could bypass Fabric's current
catalog, trust, or version constraints.

---

## 26. Studio API surface

The initial API can be HTTP or service methods. The boundary is stable either
way.

Studio may expose save/load controls for portable JSON snapshots, but the browser
must route those operations through Fabric. Catalog snapshots are tenant-scoped
catalog read-model state. Assembly snapshots are tenant/assembly-scoped workspace
state containing the assembly summary, saved layout, and draft sessions. Loading a
snapshot must call Fabric so the route tenant/assembly remain authoritative and
subsequent edits still flow through governed DCP intent validation.

HTTP-shaped version:

```text
GET  /studio/tenants/{tenantId}/catalog
GET  /studio/tenants/{tenantId}/catalog/snapshot
POST /studio/tenants/{tenantId}/catalog/snapshot
GET  /studio/tenants/{tenantId}/catalog/{entryId}/visual
GET  /studio/tenants/{tenantId}/assemblies
POST /studio/tenants/{tenantId}/assemblies
GET  /studio/tenants/{tenantId}/assemblies/{assemblyId}/snapshot
POST /studio/tenants/{tenantId}/assemblies/{assemblyId}/snapshot
POST /studio/tenants/{tenantId}/assemblies/{assemblyId}/sessions
POST /studio/tenants/{tenantId}/assemblies/{assemblyId}/sessions/{id}/intents
GET  /studio/tenants/{tenantId}/assemblies/{assemblyId}/sessions/{id}
POST /studio/tenants/{tenantId}/assemblies/{assemblyId}/sessions/{id}/compile
GET  /studio/tenants/{tenantId}/assets/{assetId}
```

Service-method version:

```text
listCatalogVisuals(tenantId)
saveCatalogSnapshot(tenantId)
loadCatalogSnapshot(tenantId, snapshot)
getCatalogVisual(tenantId, entryId)
listAssemblies(tenantId)
createAssembly(tenantId, request)
saveAssemblySnapshot(tenantId, assemblyId)
loadAssemblySnapshot(tenantId, assemblyId, snapshot)
createDraftComposition(tenantId, assemblyId, request)
applyIntent(tenantId, assemblyId, sessionId, intent)
getDraftSession(tenantId, assemblyId, sessionId)
compileCandidate(tenantId, assemblyId, sessionId)
getVisualAsset(tenantId, assetId)
```

API rules:

1. Tenant scope is enforced before catalog, asset, assembly, or session access.
2. Asset URLs are Fabric-issued, hash-pinned, and tenant-scoped.
3. Intent responses include revision information.
4. Compile/export uses the current validated assembly session revision.
5. Catalog visuals include visual integrity metadata.
6. API errors must be renderable in both 3D/2D views and table view.

---

## 27. MVP sequencing

MVP 1: read-only visualization

```text
load catalog visual entries
load existing CompositionContract + SubstrateProfile
render components, ports, pipes, substrate base plate
inspect and highlight only
2D/table inspection mode
```

MVP 2: governed draft editing

```text
draft session model
ADD_COMPONENT intent
CONNECT intent
DISCONNECT intent
REPLACE_COMPONENT intent
candidate and warning overlays
stale revision handling
undo/redo over validated intents
```

MVP 3: compile/export/sign flow

```text
compile current validated candidate
export CompositionContract
export SubstrateProfile
invoke or hand off to Fabric signing
show DecisionAudit and visual diff from prior revision
```

The first implementation should not begin with full drag/drop 3D assembly. The
first useful Studio release should make an existing contract/profile visible,
inspectable, and accessible. Interactive manipulation comes after the projection
is reliable.
