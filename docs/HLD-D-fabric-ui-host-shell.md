# HLD-D — Fabric UI / Host Shell Design (single-spa)

**Document status:** Design doc, downstream of the Product & Architecture Master Document.
**Position in the portfolio:** This document implements the **frontend facet** defined architecturally in the master doc §6A. The master doc states three architectural facts — (1) each product has a frontend that mirrors its backend independence, (2) the host shell is Fabric's frontend output, (3) a component's DCP claim and its webapp manifest are two projections of one self-description. This document is the *implementation* of those facts. The framework choice (single-spa) and all UI detail live here and are deliberately kept out of the topology document, because they can change without disturbing the architecture.

**Relationship to the backend:** This UI architecture is the isomorph of the backend. Webapps run standalone or mounted (products run standalone or co-packaged); webapps never import each other (products never import each other); webapps communicate only through host-mediated contracts (products communicate only through DCP contracts); the host shell composes webapps (Fabric collapses backends). Where this document defines a manifest, a contract, or a negotiation, it should be built from the *same shared definition* as its backend counterpart — see §8A.

---

# Design Document: single-spa Based Component Host Shell with Separate Theme System

## 1. Purpose

The proposed [reusable runtime experiences](HLD-reusable-runtime-experiences.md)
extend this shell with chat, settings, approval and governance features. Their
versioned contribution contract is separate from current app navigation manifests;
the proposal does not imply these runtime features are already implemented.

This document defines the design for a **Component Host Shell** that can aggregate multiple independently deployable component webapps.

The host shell should allow component webapps to:

- Run independently as standalone webapps
- Be mounted inside a common host container
- Be enabled or disabled based on deployment configuration
- Receive shared platform context such as tenant, user, permissions, API base URL, and theme
- Coexist with other component webapps without tight coupling
- Participate in an adaptive shell experience when the user selects a component

The theme system should remain **separate from both the host shell and component webapps**, similar in spirit to Ghost, where themes are separate artifacts from the content/application engine.

---

## 2. Design Philosophy

The platform should not be designed as one large frontend application.

It should be designed as:

```text
Host Shell
  + independently deployable component webapps
  + separately installable themes
  + shared contracts
  + controlled runtime composition
```

The core idea is:

> The host shell provides the frame.  
> Component webapps provide capability-specific experiences.  
> Themes provide visual identity.  
> The composition layer decides what is active.

---

## 3. Key Requirements

### 3.1 Component Webapp Independence

Each component webapp should be able to exist in two modes:

```text
Standalone mode
  The component webapp runs independently.

Hosted mode
  The component webapp is mounted inside the host shell.
```

Example:

```text
RAG webapp standalone:
  https://rag.example.com

RAG webapp hosted:
  https://unfurl.example.com/components/rag
```

The same codebase should support both modes with a thin bootstrap adapter.

---

### 3.2 Host Any Number of Webapps

The host shell should be able to mount any number of enabled component webapps.

Examples:

```text
/components/rag
/components/audit
/components/identity/keycloak
/components/approval
/components/workflow-studio
/components/monitoring
```

The host should not need compile-time knowledge of every possible component webapp.

---

### 3.3 Theme Must Be Separate

Theme must not be hardcoded in:

```text
Host shell
Component webapps
Backend components
Workflow definitions
```

Theme should be a separate package/artifact.

Example:

```text
themes/
  default/
  enterprise-light/
  enterprise-dark/
  cyberpunk/
  component-adaptive/
```

Themes should define design tokens, layouts, typography, spacing, density, component styling rules, and optional shell behavior.

---

### 3.4 Component-Informed Theme Adaptation

The host should support optional component-influenced theming.

Example:

```text
User opens RAG component
  Shell may adopt AI/search-oriented accent tokens

User opens Keycloak identity component
  Shell may adopt security-oriented accent tokens

User opens Audit component
  Shell may adopt monitoring/logging-oriented accent tokens
```

However:

> Components should suggest theme changes.  
> The active theme and host shell should decide how to apply them.

A component must not directly override global CSS.

---

## 4. Industry Inspiration

### 4.1 single-spa

single-spa is suitable because it provides a way to register, load, mount, and unmount independently built frontend applications.

A single-spa application exposes lifecycle functions:

```text
bootstrap
mount
unmount
```

The host shell, usually called the root config, decides when each app should be active based on route or custom activity conditions.

single-spa also recommends setups based on browser modules and import maps, which fits dynamic component loading.

---

### 4.2 Ghost Theme Separation

Ghost separates the publishing/content engine from themes. Themes are separate artifacts using Handlebars templates and can provide custom settings for controlled user customization.

For this platform, the same principle should apply:

```text
Workflow/component platform != visual theme
```

Themes should be installable, switchable, and configurable independently from component logic.

---

## 5. High-Level Architecture

```text
+---------------------------------------------------------+
|                    Component Host Shell                 |
|---------------------------------------------------------|
| single-spa root config                                  |
| shell layout                                            |
| route registry                                          |
| navigation registry                                     |
| auth context                                            |
| tenant context                                          |
| permission guard                                        |
| theme mediator                                          |
| component registry                                      |
| import map manager                                      |
| error boundaries                                        |
+---------------------------+-----------------------------+
                            |
                            v
+---------------------------------------------------------+
|                 Mounted Component Webapps               |
|---------------------------------------------------------|
| RAG Webapp                                              |
| Audit Webapp                                            |
| Keycloak Webapp                                         |
| Approval Webapp                                         |
| Workflow Studio Webapp                                  |
| Monitoring Webapp                                       |
+---------------------------+-----------------------------+
                            |
                            v
+---------------------------------------------------------+
|                    Separate Theme System                |
|---------------------------------------------------------|
| Theme registry                                          |
| active theme                                            |
| design tokens                                           |
| layout tokens                                           |
| density settings                                        |
| component visual mappings                               |
| component theme contribution policy                     |
+---------------------------------------------------------+
```

---

## 6. Major Building Blocks

### 6.1 Host Shell

The host shell is responsible for:

```text
Application frame
Global layout
Route registration
Navigation assembly
Auth context
Tenant context
Permission checks
Theme mediation
Component webapp loading
Import map management
Cross-component event bus
Error isolation
```

The shell should not own component-specific business UI.

---

### 6.2 Component Webapps

Each component webapp owns its own capability experience.

#### RAG Webapp

```text
RAG configuration
Data source setup
Index health
Retrieval test
Query playground
RAG workflow node configuration
```

#### Audit Webapp

```text
Audit event browser
Workflow event timeline
Audit sink configuration
Retention settings
Compliance export
```

#### Keycloak Identity Webapp

```text
Identity provider setup
Realm/client configuration
Role mapping
Token validation test
Login integration settings
```

#### Approval Webapp

```text
Approval queue
Approval rules
Approver role configuration
Decision history
Escalation configuration
```

#### Fabric Studio Webapp

```text
Visual catalog explorer
3D component assembly surface
Port and dependency manipulation
DCP validation feedback
SubstrateProfile visualization
CompositionContract preview
DecisionAudit inspection
AI advisor interaction
```

The Fabric Studio webapp is the visual composition surface for Fabric. It is
mounted by the host shell like any other component webapp, for example:

```text
/components/fabric-studio
/components/composition
/components/assembly
```

Its role is to render and manipulate Intelligent Components visually while
delegating all semantic validation to Fabric/DCP. It loads component visual
manifests, renders offers/dependencies/refusals as ports and connectors, sends
operator manipulation intents to the Fabric backend, displays validation
results, shows the derived `SubstrateProfile` as the closed-world runtime
surface, and exports the `CompositionContract` + `SubstrateProfile` through
Fabric.

Each component webapp can run standalone or hosted.

---

### 6.3 Theme System

The theme system is a separate concern.

It should provide:

```text
Theme registry
Active theme selection
Theme package loading
Design token resolution
Component theme contribution resolution
User-level theme preference
Tenant-level theme preference
Component-adaptive theme behavior
```

Theme artifacts should be separate from component webapps.

---

## 7. single-spa Host Design

### 7.1 Root Config

The host shell should have a single-spa root config responsible for registering component applications.

Conceptual example:

```ts
registerApplication({
  name: "@unfurl/rag-webapp",
  app: () => System.import("@unfurl/rag-webapp"),
  activeWhen: location => location.pathname.startsWith("/components/rag"),
  customProps: () => createMicroAppProps("rag-basic")
});
```

The root config should not hardcode all components permanently.

Instead, it should read enabled component webapps from the component registry.

---

### 7.2 Dynamic Registration Flow

```text
1. Host shell starts
2. Host loads platform configuration
3. Host loads enabled component manifests
4. Host loads active import map
5. Host registers enabled component webapps with single-spa
6. Host starts single-spa
7. Apps mount/unmount based on route/activity rules
```

---

### 7.3 Import Maps

Import maps should map component webapp names to deployed bundle URLs.

Example:

```json
{
  "imports": {
    "@unfurl/rag-webapp": "https://cdn.example.com/rag-webapp/1.0.0/main.js",
    "@unfurl/audit-webapp": "https://cdn.example.com/audit-webapp/1.0.0/main.js",
    "@unfurl/keycloak-webapp": "https://cdn.example.com/keycloak-webapp/1.0.0/main.js"
  }
}
```

This allows independent deployment.

When a component webapp is upgraded, the import map can point to a new version.

---

## 8. Component Webapp Manifest

Each component should declare its webapp contribution.

Example:

```yaml
component:
  id: rag-basic
  name: RAG Component
  version: 1.0.0

backend:
  provides:
    - rag.query
    - rag.index

webapp:
  type: single-spa-application
  name: "@unfurl/rag-webapp"
  routePrefix: /components/rag
  standaloneUrl: https://rag.example.com

  importMap:
    key: "@unfurl/rag-webapp"

  navigation:
    section: AI
    title: RAG
    icon: search
    order: 20

  permissions:
    - rag.view
    - rag.admin
    - rag.test

  themeContribution:
    mode: suggestive
    tokens:
      accent.intent: ai
      accent.color: violet
      icon: search
      density: comfortable
```

---

## 8A. The webapp manifest is a projection of the DCP claim (load-bearing)

This is the hinge that connects this document to the rest of the system, and it is more important than any single-spa detail in this doc. (It corresponds to old design rule 10, here promoted from a footnote to a first-class principle, as the master doc §6A requires.)

A component does **not** have a backend description and a separate, independent frontend description that "should be kept in sync." A component has **one self-description with two facets**. The frontend facet can contain multiple projections, including the webapp manifest and the Fabric Studio visual manifest:

```text
                 Component Self-Description
                 (one source of truth)
                          |
            +-------------+-------------+
            |                           |
            v                           v
     Backend facet                Frontend facet
     = DCP claim                  = webapp + visual manifests
     ----------------             --------------------------
     capabilities                 routes / routePrefix
     refusals                     navigation (section, title, icon)
     dependencies                 permissions
     offers                       theme contribution
     substrate dependencies        visual ports / handles
     negotiation surface          standalone vs hosted bootstrap
```

The fields are not arbitrary on either side — they are derived from the same component identity:

- The webapp's `permissions` (e.g. `rag.view`, `rag.admin`) are the frontend view of the access boundaries the DCP claim already implies. They must not be invented separately on the frontend.
- The webapp's `navigation` and `routePrefix` describe how the component's *offers* surface to a human, the way the DCP `offers` describe how they surface to another component.
- The webapp's `themeContribution` (suggest-vs-decide) is the frontend instance of the DCP negotiation pattern: the component proposes, the host/policy disposes. The theme-policy engine (§10.6) and the backend DCP negotiation engine are the same shape and should share machinery, not be built twice.

**Build rule.** The frontend manifest and the DCP claim are generated from, or validated against, a single shared component-description definition. Building two parallel manifest systems that drift is exactly the failure the backend isolation discipline exists to prevent. When the backend `unfurl-dcp` claim schema is defined, the webapp manifest schema is derived from it — not authored independently.

**Consequence for `unfurl-dcp`.** The DCP claim schema in `unfurl-dcp` should be designed knowing it has a frontend projection. The claim is the source of truth; the webapp manifest is a view. This affects how the claim schema is structured (it must carry, or cleanly derive, the human-surface facts the frontend needs) and is a reason to specify the claim schema and the webapp manifest schema together.

---

## 8B. Visual manifest projection for Fabric Studio

Fabric Studio introduces a third frontend-facing projection of the same
component self-description: the **visual manifest**. This manifest tells Studio
how to render DCP facts, not whether those facts are valid.

Example:

```yaml
visual:
  model:
    type: GLB
    path: META-INF/visual/component.glb

  fallbackShape:
    kind: CUBE
    category: STORAGE

  ports:
    - id: storage-put
      mapsTo: claim.offers[storage.put]
      kind: OFFER
      anchor: right-upper
      connectorShape: SQUARE_SOCKET

    - id: secrets-provider
      mapsTo: claim.dependencies[secrets.provider]
      kind: SUBSTRATE_DEPENDENCY
      anchor: bottom-left
      connectorShape: HEX_SOCKET

  interactions:
    draggable: true
    connectable: true
    inspectable: true
```

Important rule:

> The visual manifest must not define compatibility. It only defines how DCP
> facts are rendered. DCP/Fabric remains the source of truth.

A visual manifest may only map to DCP-declared facts: offers, dependencies,
refusals, substrate dependencies, lifecycle, binding modes, and trust status.
It must not introduce semantic ports that do not exist in the component claim.

The visual manifest may point to optional GLB assets and thumbnails, but Studio
must support generated fallback shapes so component authors are not forced to
provide custom 3D models.

If a GLB model is missing, invalid, or blocked by policy, Studio must render a
generated fallback shape from the semantic category.

For JVM-backed components, the visual manifest may be embedded in the catalog
artifact under `META-INF/unfurl-visual.yaml` or included as part of the unified
component self-description. GLB models and thumbnails may live under
`META-INF/visual/`. For frontend-only components, equivalent visual metadata may
be emitted with the webapp manifest. In all cases, it must be generated from or
validated against the same shared component description.

---

## 9. Hosted vs Standalone Mode

### 9.1 Hosted Mode

In hosted mode, the component webapp is mounted by the host shell.

It receives platform context through standard props.

```ts
type UnfurlMicroAppProps = {
  mode: "hosted";
  componentId: string;
  tenantId: string;
  user: {
    id: string;
    roles: string[];
    permissions: string[];
  };
  auth: {
    getAccessToken: () => Promise<string>;
  };
  api: {
    platformBaseUrl: string;
    componentBaseUrl: string;
  };
  theme: {
    activeThemeId: string;
    tokens: Record<string, string>;
    mode: "host" | "component-adaptive";
  };
  eventBus: {
    publish: (eventName: string, payload: unknown) => void;
    subscribe: (
      eventName: string,
      handler: (payload: unknown) => void
    ) => () => void;
  };
};
```

---

### 9.2 Standalone Mode

In standalone mode, the component webapp owns its own bootstrap.

It may use:

```text
Local routing
Local layout
Local development auth
Direct component API URL
Local theme preview
```

Example:

```ts
type StandaloneAppConfig = {
  mode: "standalone";
  componentBaseUrl: string;
  authMode: "dev" | "oidc" | "none";
  themeId: string;
};
```

The standalone app should still use the same internal pages and services as hosted mode.

Only the bootstrap differs.

---

## 10. Theme System Design

### 10.1 Theme as Separate Artifact

A theme should be installable independently.

Example theme package:

```text
themes/enterprise-light/
  theme.yaml
  tokens.json
  shell-layout.json
  component-mappings.json
  preview.png
  README.md
```

---

### 10.2 Theme Manifest

Example:

```yaml
theme:
  id: enterprise-light
  name: Enterprise Light
  version: 1.0.0

compatibility:
  hostShell: ">=1.0.0 <2.0.0"

tokens:
  file: tokens.json

layout:
  file: shell-layout.json

componentMappings:
  file: component-mappings.json

settings:
  allowUserAccentOverride: true
  allowDensitySelection: true
  allowComponentAdaptiveMode: true
```

---

### 10.3 Theme Tokens

Example:

```json
{
  "color.background": "#ffffff",
  "color.surface": "#f8fafc",
  "color.text.primary": "#111827",
  "color.text.secondary": "#4b5563",
  "color.border": "#e5e7eb",
  "color.accent": "#2563eb",
  "radius.sm": "4px",
  "radius.md": "8px",
  "radius.lg": "12px",
  "spacing.sm": "8px",
  "spacing.md": "16px",
  "spacing.lg": "24px",
  "font.family.base": "Inter, system-ui, sans-serif",
  "density": "comfortable"
}
```

---

### 10.4 Component Theme Contribution

Components may suggest theme tokens, but the active theme decides how to interpret them.

Example component contribution:

```yaml
themeContribution:
  mode: suggestive
  tokens:
    accent.intent: security
    accent.color: blue
    tone: secure
```

The active theme may map this to:

```json
{
  "color.accent": "#1d4ed8",
  "shell.header.icon": "shield",
  "shell.surface.treatment": "solid"
}
```

---

### 10.5 Theme Resolution Pipeline

```text
Base theme tokens
        |
        v
Tenant overrides
        |
        v
User preferences
        |
        v
Selected component theme contribution
        |
        v
Host theme policy
        |
        v
Resolved runtime tokens
        |
        v
Host shell + mounted component webapps
```

The host should expose resolved tokens as:

```text
CSS variables
JavaScript theme object
single-spa custom props
theme change events
```

Fabric Studio should receive semantic visual tokens the same way:

```json
{
  "fabricStudio.port.offer.color": "#22c55e",
  "fabricStudio.port.dependency.color": "#f97316",
  "fabricStudio.port.refusal.color": "#ef4444",
  "fabricStudio.pipe.valid.material": "glow",
  "fabricStudio.pipe.invalid.material": "pulse",
  "fabricStudio.substrate.active.color": "#2563eb",
  "fabricStudio.substrate.inactive.opacity": "0.25"
}
```

Components and visual manifests can suggest visual intent, but the active theme
decides final colors, material treatments, opacity, glow, and motion.

---

### 10.6 Theme Policy Modes

```yaml
themePolicy:
  mode: host-only
```

The host theme always wins. Components cannot influence theme.

```yaml
themePolicy:
  mode: component-adaptive
```

The selected component can influence shell theme through controlled tokens.

```yaml
themePolicy:
  mode: user-selectable
```

User chooses whether component-adaptive behavior is enabled.

```yaml
themePolicy:
  mode: tenant-controlled
```

Tenant admin controls whether adaptive theming is allowed.

---

## 11. Route and Navigation Composition

### 11.1 Route Registration

Component webapps declare route prefixes.

```yaml
webapp:
  routePrefix: /components/rag
```

The host registers:

```text
/components/rag/*
```

to mount:

```text
@unfurl/rag-webapp
```

---

### 11.2 Navigation Assembly

Component manifests contribute navigation items.

```yaml
navigation:
  section: AI
  title: RAG
  icon: search
  order: 20
```

The host builds navigation after filtering by permissions.

---

### 11.3 Permission Filtering

If user does not have `rag.view`, the RAG navigation item is hidden.

If user opens route directly, the shell blocks access before mounting the app where possible.

---

## 12. Cross-App Communication

Component webapps should not directly import each other.

Use host-mediated communication.

### 12.1 Event Bus

```ts
eventBus.publish("workflow:selected", {
  workflowId: "wf-123"
});
```

```ts
eventBus.subscribe("tenant:changed", handler);
```

---

### 12.2 Allowed Events

Define stable event names.

```text
tenant:changed
theme:changed
component:selected
workflow:selected
workflow:execution-started
workflow:execution-completed
component:health-changed
notification:show
```

Avoid arbitrary cross-app event chaos.

---

## 12A. Fabric Studio manipulation intents

Fabric Studio manipulates a visual scene, but it must not directly mutate
contracts. Every semantic manipulation is emitted as an operator intent and
validated by Fabric.

Example intent:

```json
{
  "type": "CONNECT_PORTS",
  "from": "storage-s3.storage.put",
  "to": "workflow.storage.required"
}
```

Valid response:

```json
{
  "status": "VALID",
  "candidateId": "cand-abc123",
  "requiredSubstratePorts": [
    "secrets.provider",
    "storage.blob",
    "telemetry.otel"
  ]
}
```

Invalid response:

```json
{
  "status": "INVALID",
  "reason": "Capability version conflict",
  "details": "storage.put@2.0 cannot satisfy storage.put@^1"
}
```

The Studio scene updates contract-relevant state only after Fabric returns a
validated response. Layout-only state such as camera position or component
placement may be stored locally, but composition state comes from Fabric.

Fabric Studio may store layout-only state locally, such as camera position,
object placement, grouping, and user annotations. Contract-relevant state must
come from Fabric validation responses. Studio must not produce a
`CompositionContract` by serializing its scene graph.

This keeps the 3D surface governed:

```text
operator gesture -> Studio intent -> Fabric validation -> DCP decision -> scene update
```

### 12A.1 Fabric Studio API boundary

Fabric Studio talks to Fabric through a validation/planning API:

```text
listCatalogVisuals
loadCompositionView
createDraftComposition
applyIntent
validateDraft
compileCandidate
exportContract
```

These operations form the frontend/backend boundary for Studio. The frontend may
render, inspect, and request changes, but Fabric owns semantic validation,
candidate identity, compile output, and export artifacts.

### 12A.2 Large-catalog performance

Fabric Studio should not render the entire catalog as a 3D scene. The catalog
palette can be searchable and list-based, while the 3D/2D surface renders only
the active composition, selected candidates, and immediate alternatives.

---

## 13. Security Model

### 13.1 Host-Owned Security

The host shell owns:

```text
Authentication state
Tenant context
Permission evaluation
Route guarding
Token acquisition
Component access policy
```

Component webapps should not own global auth when hosted.

---

### 13.2 Component API Calls

Component webapps should call backend APIs through a shared API client.

```ts
api.componentBaseUrl
auth.getAccessToken()
```

They should not store tokens independently.

---

### 13.3 Trusted vs Untrusted Component Webapps

#### Trusted components

Built by the platform/team.

Can be loaded using single-spa/import maps.

Even trusted hosted webapp manifests must be signed or hash-pinned before the
host shell loads their import-map entries. The host should verify:

```text
allowed origin
expected bundle hash / SRI hash
component identity
manifest signature or manifest hash
host-shell compatibility
permission scope compatibility
```

The frontend trust model should mirror the backend artifact-pinning model:

| Artifact | Pinning model |
|---|---|
| Backend component JAR | JAR SHA-256 |
| Frontend webapp bundle | Manifest hash and/or SRI hash |
| Theme artifact | Theme hash |
| Visual model asset | Visual manifest hash and asset hash |

#### Untrusted third-party components

Should eventually be sandboxed using:

```text
iframe isolation
strict CSP
signed manifests
restricted event bridge
permission scopes
```

This can be a later phase.

---

## 14. Error Isolation

Each mounted component webapp should be wrapped in an error boundary.

If one app fails:

```text
RAG webapp crashes
```

The host shell should remain alive and show:

```text
This component failed to load.
Retry
View logs
Disable component
```

The failure should not crash the full shell.

---

## 15. Versioning and Compatibility

Each component webapp should declare compatibility.

```yaml
compatibility:
  hostShell: ">=1.0.0 <2.0.0"
  hostShellApi: ">=1.0.0 <2.0.0"
  microAppProps: ">=1.0.0 <2.0.0"
  eventBus: ">=1.0.0 <2.0.0"
  themeSystem: ">=1.0.0 <2.0.0"
  componentContract: "rag-basic@1.x"
```

The host should reject incompatible webapps at registration time. This is
important because breaking `UnfurlMicroAppProps` or host event names can break
a hosted app even when route and theme compatibility are still valid.

---

## 16. Deployment Models

### 16.1 Local Development

```text
Host shell runs on localhost:9000
RAG webapp runs on localhost:9001
Audit webapp runs on localhost:9002
Import map points to local bundles
```

---

### 16.2 Enterprise Single Deployment

All webapp bundles are built and deployed together, but still mounted via single-spa.

```text
One deployment
Multiple independently structured webapps
Controlled activation through config
```

---

### 16.3 Independent Component Deployment

Each webapp is deployed separately.

```text
rag-webapp deployed independently
audit-webapp deployed independently
host import map updated
```

---

### 16.4 Marketplace/Future Deployment

Component webapps are discovered from a component catalog.

```text
Install component
Validate manifest
Update import map
Register routes
Enable navigation
```

---

## 17. Recommended Repository Structure

### Option A: Monorepo First

Recommended for early implementation.

```text
unfurl-ui/
  apps/
    host-shell/
    fabric-studio-webapp/
    rag-webapp/
    audit-webapp/
    keycloak-webapp/
    workflow-studio-webapp/

  packages/
    ui-contracts/
    theme-engine/
    auth-client/
    api-client/
    event-bus/
    component-manifest/
    visual-manifest/
    fabric-scene-model/
    fabric-validation-client/
    three-renderer/
    graph-layout/
    design-system/

  themes/
    default/
    enterprise-light/
    enterprise-dark/
```

This allows independent apps while keeping development simple.

---

### Option B: Separate Repositories Later

```text
unfurl-host-shell
unfurl-webapp-rag
unfurl-webapp-audit
unfurl-webapp-keycloak
unfurl-theme-enterprise-light
unfurl-theme-enterprise-dark
```

Use this when independent teams or marketplace distribution become important.

---

## 18. Initial Implementation Scope

Start small.

### Build first

```text
Host shell
single-spa root config
Import map support
Theme engine
Default theme
Component manifest parser
Route/navigation registry
Permission guard
RAG sample webapp
Audit sample webapp
Shared props contract
Hosted/standalone bootstrap pattern
```

### Avoid initially

```text
Marketplace
Third-party untrusted apps
iframe sandboxing
Module Federation
Complex cross-app workflows
Runtime theme designer
Multiple frontend frameworks
```

---

## 19. Suggested Implementation Phases

### Phase UI-1: Host Shell Foundation

Deliver:

```text
single-spa root config
shell layout
route registry
navigation registry
component manifest loading
static import map
```

Acceptance:

```text
Host can mount two sample webapps by route.
Navigation is generated from manifests.
Disabled component webapp does not appear or mount.
```

---

### Phase UI-2: Component Webapp Contract

Deliver:

```text
UnfurlMicroAppProps
hosted bootstrap
standalone bootstrap
shared API client
shared auth accessor
shared event bus
```

Acceptance:

```text
Same RAG webapp runs standalone and hosted.
Same Audit webapp runs standalone and hosted.
Hosted mode receives tenant/user/theme/api props from host.
```

---

### Phase UI-3: Theme Engine

Deliver:

```text
theme manifest
theme registry
token loader
CSS variable injection
theme switcher
theme policy engine
```

Acceptance:

```text
Theme can be switched without rebuilding apps.
Host shell and mounted apps receive resolved tokens.
Component webapp does not hardcode global theme.
```

---

### Phase UI-4: Component-Adaptive Theme

Deliver:

```text
component theme contribution model
selected component detection
theme resolution pipeline
host-only and component-adaptive modes
```

Acceptance:

```text
When RAG is selected, shell can apply RAG-suggested accent tokens.
When Audit is selected, shell can apply Audit-suggested accent tokens.
Host-only mode ignores component suggestions.
```

---

### Phase UI-5: Security and Permissions

Deliver:

```text
route permission guard
navigation permission filtering
token provider abstraction
tenant context propagation
```

Acceptance:

```text
Unauthorized routes are blocked.
Unauthorized navigation items are hidden.
Mounted apps receive consistent tenant/user context.
```

---

### Phase UI-6: Error Isolation and Compatibility

Deliver:

```text
component error boundary
load failure screen
manifest compatibility checks
theme compatibility checks
```

Acceptance:

```text
Broken component webapp does not crash host shell.
Incompatible component webapp is not mounted.
User sees meaningful error message.
```

---

### Phase UI-7: Fabric Studio / Visual Composition Surface

Deliver:

```text
visual manifest schema
catalog visual loader
2D/3D scene model
component palette
port rendering
pipe rendering
read-only CompositionContract visualization
SubstrateProfile visualization
```

Acceptance:

```text
Fabric Studio loads catalog entries and renders components with ports.
Offers, dependencies, refusals, and substrate dependencies are visually distinct.
SubstrateProfile appears as a closed-world base layer.
No contract is generated directly from UI state without Fabric validation.
A 2D/table inspection mode exists for keyboard-accessible review of components, ports, pipes, and validation results.
```

This phase should start read-only. The first useful Studio version visualizes an
existing `CompositionContract` and `SubstrateProfile`, supports inspect and
highlight flows, and explains what Fabric already decided.

---

### Phase UI-8: Interactive Manipulation

Deliver:

```text
ADD_COMPONENT intent
CONNECT_PORTS intent
DISCONNECT intent
REPLACE_COMPONENT intent
Fabric validation client
Candidate/NoMatch/Ambiguous overlay
compile/export flow
```

Acceptance:

```text
Studio sends every semantic manipulation to Fabric as an intent.
Fabric validates the intent before contract-relevant scene state changes.
Invalid intents show DCP/Fabric reasons.
Valid intents update candidate, substrate port, warning, and audit overlays.
Compile/export uses Fabric compiler output, not scene serialization.
```

---

## 20. Final Target Architecture

```text
Browser
  |
  v
+------------------------------------------------------+
|                  Unfurl Host Shell                   |
|------------------------------------------------------|
| single-spa root config                               |
| app frame                                            |
| route/navigation registry                            |
| auth/tenant context                                  |
| permission guard                                     |
| theme mediator                                       |
| import map manager                                   |
| event bus                                            |
| error isolation                                      |
+-------------------------+----------------------------+
                          |
                          v
+------------------------------------------------------+
|              Component Webapps                       |
|------------------------------------------------------|
| @unfurl/rag-webapp                                   |
| @unfurl/audit-webapp                                 |
| @unfurl/keycloak-webapp                              |
| @unfurl/approval-webapp                              |
| @unfurl/workflow-studio-webapp                       |
| @unfurl/fabric-studio-webapp                         |
+-------------------------+----------------------------+
                          |
                          v
+------------------------------------------------------+
|              Separate Theme Packages                 |
|------------------------------------------------------|
| default                                              |
| enterprise-light                                     |
| enterprise-dark                                      |
| component-adaptive                                   |
+------------------------------------------------------+
```

Fabric Studio is a mounted component webapp inside this architecture, not a
replacement for the host shell. It renders the visual composition surface,
while the host shell still owns frame, routing, context, permissions, theme
mediation, import maps, and error isolation.

---

## 21. Key Design Rules

1. The host shell owns the frame.
2. Component webapps own capability-specific experiences.
3. Themes are separate artifacts.
4. Components can suggest theme changes but cannot directly override global CSS.
5. The shell mediates theme resolution.
6. Each component webapp must support hosted and standalone mode.
7. Component webapps must communicate through host-provided contracts.
8. The host must be able to mount any number of enabled component webapps.
9. The host must be able to disable component webapps without breaking the shell.
10. **A component's webapp manifest is a projection of its DCP claim, not a separate artifact that "should align" — see §8A.** Backend claim and frontend manifest are two views of one self-description, generated from a shared definition. This is a hard rule, not an eventual aspiration.

---

Additional Fabric Studio rules:

11. Visual manifests are also projections of the same self-description. They render DCP facts; they do not define compatibility.
12. Fabric Studio emits operator intents. Fabric validates those intents. Contracts are produced by Fabric, not by serializing Studio scene state.
13. Frontend bundles, visual model assets, and themes should be signed or hash-pinned before the host loads them.
14. Visual manifests may only render DCP-declared facts; they must not introduce semantic ports.
15. Custom 3D models are optional. Fabric Studio must support generated fallback shapes.
16. Fabric Studio should provide a 2D/accessibility fallback for large or non-visual workflows.

---

## 22. References

- single-spa applications require lifecycle functions such as `bootstrap`, `mount`, and `unmount`.
- single-spa recommends in-browser ES modules and import maps for its recommended setup.
- Ghost separates themes from the core publishing platform, uses Handlebars templates, and supports controlled custom settings in themes.
