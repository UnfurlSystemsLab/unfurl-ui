# unfurl-ui

Use `unfurl-ui` when you need the browser experience for Unfurl: the host shell,
Fabric Studio, shared UI contracts, visual scene model, theming, and rendering
packages. It is the frontend workspace that lets operators inspect, author, and
validate governed compositions without making the visual scene the source of
truth.

## License And Community Model

`unfurl-ui` is published under the [Apache License 2.0](LICENSE). Contributions
are accepted under the same license unless explicitly stated otherwise.

Unfurl Studio's community UI surface is intended to stay open so contributors
can improve the host shell, visual composition experience, shared UI contracts,
themes, and rendering packages. Enterprise-only modules, hosted services,
managed deployments, support, and commercial integrations may be offered under
separate commercial terms outside this community repository.

`unfurl-ui` is the coordinated frontend workspace for Unfurl. It is the frontend analogue of the multi-module `unfurl-substrate` repo: one coherent layer with multiple narrow apps and packages that release together.

The workspace starts with the host shell and Fabric Studio scaffolding from:

- `docs/HLD-D-fabric-ui-host-shell.md`
- `docs/LLD-unfurl-studio-visual-composition.md`
- `docs/SECURITY.md`
- `docs/RELIABILITY.md`

## Workspace Model

Proposed runtime UI work is defined separately from current implementation:

- [Reusable chat and settings HLD](docs/HLD-reusable-runtime-experiences.md)
- [Feature contribution and client contracts LLD](docs/LLD-reusable-runtime-experiences.md)
- [Delivery and acceptance plan](docs/REPO-reusable-runtime-experiences-build-spec.md)

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

`npm run dev:studio` runs in live mode against a running Fabric Studio backend. Dev requests are origin-relative (`/studio/...`) and go through the Vite `/studio` proxy (see `apps/host-shell/vite.config.ts`), which forwards to the backend on `:7878` — so you do **not** need to set `VITE_STUDIO_API_BASE_URL`, and a down backend shows a readable proxy error instead of the browser's opaque "Failed to fetch":

```powershell
npm run dev:studio
```

VS Code live debug compounds use `scripts/wait-studio-backend.ps1` to wait for
`http://127.0.0.1:7878/health` before opening the browser. If that wait times
out, start `Studio: backend (:7878)` / `Studio: authoring backend (:7878)` or
switch to fixture mode instead of continuing into Vite proxy errors.

Set `VITE_STUDIO_API_BASE_URL` only to target a backend on a different origin (bypasses the proxy; relies on the backend's dev CORS). For offline mock data with no backend, use fixture mode:

```powershell
npm run dev:studio:fixture
```

Useful options:

```powershell
.\scripts\launch-studio.ps1 -Mode fixture -Port 5174
.\scripts\launch-studio.ps1 -Mode preview -NoOpen
.\scripts\launch-studio.ps1 -Mode preview -NoBuild
```

### Startup With Lab Services

Use the root startup script when Studio should run against the real Lab service
containers instead of fixture data. On Windows, the batch wrapper is the
simplest entry point:

```bat
Startup.bat
```

PowerShell can call the implementation directly:

```powershell
.\Startup.ps1
```

By default, startup pulls these GitHub Container Registry images, starts them
with Docker Compose, waits for their health endpoints, then launches Studio in
live mode at `http://127.0.0.1:5173/components/fabric-studio/workspace`:

```text
ghcr.io/unfurlsystemslab/unfurl-fabric-studio:0.1.0-snapshot
ghcr.io/unfurlsystemslab/unfurl-foundry:0.1.0-snapshot
ghcr.io/unfurlsystemslab/unfurl-flow:0.1.0-snapshot
```

Validate only the dependency pull/start/health path without launching the UI:

```bat
Startup.bat -Mode dev -NoUi
```

Skip the GHCR pull when testing freshly built local images:

```powershell
.\Startup.ps1 -Mode dev -NoPull -NoUi
```

Stop the Lab service containers:

```powershell
.\Stop.ps1
```

Batch and Bash wrappers are also available:

```bat
Stop.bat
```

```bash
./Stop.sh
```

The stop scripts also terminate local Unfurl UI Vite/Node processes on the
Studio ports (`5173`, `5174`, and preview `4173`) plus their child processes.
They do not stop unrelated Docker containers or arbitrary Node processes.

### Debug With VS Code

Open the `unfurl-ui` folder in VS Code and start the Lab stack before launching
the browser debugger:

```powershell
.\Startup.ps1
```

Then run one of the shared launch configurations:

```text
Unfurl UI: Studio (Edge, after Startup.ps1)
Unfurl UI: Studio (Chrome, after Startup.ps1)
```

The launch configuration does not start Docker, Fabric, Foundry, Flow, or Vite.
Its preflight task only verifies that `Startup.ps1` already made
`http://127.0.0.1:7878/health`, `http://127.0.0.1:7979/health`,
`http://127.0.0.1:8080/health`, and the Studio UI route on `:5173` reachable.
If any check fails, restart with `.\Startup.ps1` before debugging.

Use `-RemoveVolumes` only when you want to delete the local Studio state volume
created by Docker Compose:

```powershell
.\Stop.ps1 -RemoveVolumes
```

Foundry credentials remain outside source. Put local values such as
`UNFURL_FOUNDRY_CREDENTIAL_KEY`, `GEMINI_API_KEY`, and
`UNFURL_FOUNDRY_MODEL_PROVIDER=spring-ai-google-genai` in
`../.debug/foundry.env`, or export them in the shell before startup. The script
copies the Foundry deployment metadata into `.startup/foundry-deployment` and
rewrites Fabric tool endpoints for the Docker network; `.startup/` is ignored.

Build and push the dependent images to the Lab registry:

```powershell
.\scripts\Publish-DependentImages.ps1 -Push
```

For a local push, Docker must be logged into GHCR with a token that has
`write:packages`, `read:packages`, and access to `UnfurlSystemsLab`:

```powershell
$env:GHCR_USER = gh api user --jq .login
$env:GHCR_TOKEN = "<classic PAT with repo, read:packages, write:packages>"
$env:GHCR_TOKEN | docker login ghcr.io -u $env:GHCR_USER --password-stdin
.\scripts\Publish-DependentImages.ps1 -Push
```

The same image publish path is available in GitHub Actions as the manual
`Manual Publish Lab Docker Images` workflow. It uses the org `CI_REPO_TOKEN` to
check out private Lab repos, read Maven packages, and push GHCR images.

Or publish first and then start:

```powershell
.\Startup.ps1 -PublishImages
```

Bash is also available on machines with Docker and PowerShell installed:

```bash
./Startup.sh --mode dev
```

### Demo fallbacks

By default the workspace shows real backend data or an honest empty/error state. When an
endpoint returns nothing it does **not** invent content — no generated catalog, no sample
assembly, no local demo replacement options. To re-enable that demo content for offline UI
development, demos, or screenshots without a live backend:

```powershell
$env:VITE_STUDIO_DEMO_FALLBACKS = "true"
npm run dev:studio
```
