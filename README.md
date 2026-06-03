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
- Packages must not import app code.
- Shared packages should avoid provider SDKs, backend implementation details, or runtime-only assumptions.

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
