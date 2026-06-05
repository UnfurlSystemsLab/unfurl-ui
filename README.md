# unfurl-ui

`unfurl-ui` is the coordinated frontend workspace for Unfurl. It is the frontend analogue of the multi-module `unfurl-substrate` repo: one coherent layer with multiple narrow apps and packages that release together.

The workspace starts with the host shell and Fabric Studio scaffolding from:

- `docs/HLD-D-fabric-ui-host-shell.md`
- `docs/LLD-unfurl-studio-visual-composition.md`

## Workspace Model

```text
unfurl-ui/
  apps/
    host-shell/
    fabric-studio-webapp/

  packages/
    ui-contracts/
    event-bus/
    component-manifest/
    visual-manifest/
    fabric-scene-model/
    fabric-validation-client/
    theme-engine/
    three-renderer/
    graph-layout/
    design-system/
```

## Apps

| App | Purpose |
|---|---|
| `host-shell` | single-spa host shell frame: routing, navigation, auth/tenant context, import maps, theme mediation, event bus, and mounted app lifecycle. |
| `fabric-studio-webapp` | Unfurl Studio: visual governed composition surface for catalog entries, contracts, substrate profiles, validation intents, and advisor interaction. |

## Packages

| Package | Purpose |
|---|---|
| `ui-contracts` | Shared host/app contracts such as `UnfurlMicroAppProps`, event bus types, compatibility ranges, and route metadata. |
| `event-bus` | Host-mediated in-memory event bus implementation for local shell/webapp communication. |
| `component-manifest` | Webapp manifest types and validation helpers. |
| `visual-manifest` | `unfurl-visual.yaml` projection types and visual integrity records. |
| `fabric-scene-model` | Studio scene graph, draft session, view state, and composition state types. |
| `fabric-validation-client` | Studio-to-Fabric intent and validation API contracts. |
| `theme-engine` | Theme manifests, token resolution, component-adaptive policy, and Fabric Studio visual tokens. |
| `three-renderer` | Renderer-facing contracts for generated shapes, GLB assets, ports, pipes, and substrate base plate. |
| `graph-layout` | 2D graph and layout helpers for accessibility and large-catalog workflows. |
| `design-system` | Shared UI primitives and design-token names. |

## Boundary Rules

- The host shell owns frame, routing, permissions, theme mediation, import maps, and app lifecycle.
- Component webapps own capability-specific experiences.
- Fabric Studio is a mounted webapp, not a replacement for the host shell.
- Visual manifests render DCP-declared facts; they do not define compatibility.
- Studio emits operator intents. Fabric validates them. Contracts come from Fabric compiler output.
- Studio deployment choices produce a `DeploymentPolicy` draft. Fabric still resolves the signed `BindingPlan`.
- Packages must not import app code.
- Shared packages should avoid provider SDKs, backend implementation details, or runtime-only assumptions.

## Deployment Planner

Unfurl Studio includes a deployment planner surface for choosing how selected components should physically run before compile/export.

Supported choices:

| Shape | UI Meaning |
|---|---|
| `IN_PROCESS_LIBRARY` | Prefer local embedded components. |
| `MODULAR_MONOLITH_MODULE` | Prefer one process with module boundaries. |
| `STANDALONE_JAVA_APP` | Prefer separate JVM processes. |
| `SPRING_BOOT_SERVICE` | Prefer Spring Boot services. |
| `REMOTE_MICROSERVICE` | Prefer remote service bindings. |
| `CONTAINERIZED_SERVICE` | Prefer platform-managed containers. |
| `MANAGED_EXTERNAL_ADAPTER` | Prefer customer-managed external systems through adapters. |

The Studio component lets operators:

- order `preferredShapes`
- mark `disallowedShapes`
- require isolation for capability patterns such as `ai.*`
- declare runtime facilities such as Java version, Spring Boot, Kubernetes, service mesh, and maximum service count
- pass the resulting policy draft to Fabric during `createDraftComposition`, `resolveDeployment`, or `compileCandidate`

The UI does not serialize its scene graph into a contract. Deployment selections are operator intent and policy input; Fabric resolves the final `BindingPlan`, embeds it in the compiled contract, and signs it with the rest of the contract.

## Build

Install dependencies:

```bash
npm install
```

Type-check the workspace:

```bash
npm run typecheck
```

Clean generated build artifacts:

```bash
npm run clean
```

## Launch Studio

Start the Studio workbench with fixture data for manual UI testing:

```powershell
npm run launch:studio
```

The launcher opens:

```text
http://127.0.0.1:5173/components/fabric-studio/workspace
```

Run the production bundle preview instead:

```powershell
.\scripts\launch-studio.ps1 -Mode preview
```

Studio defaults to fixture mode for standalone manual testing, so it will not call `http://127.0.0.1:7878` unless live mode is explicitly requested. To test against a running Fabric Studio API:

```powershell
$env:VITE_STUDIO_MODE = "live"
$env:VITE_STUDIO_API_BASE_URL = "http://127.0.0.1:7878"
npm run dev:studio
```

Useful options:

```powershell
.\scripts\launch-studio.ps1 -Mode fixture -Port 5174
.\scripts\launch-studio.ps1 -Mode preview -NoOpen
.\scripts\launch-studio.ps1 -Mode preview -NoBuild
```
