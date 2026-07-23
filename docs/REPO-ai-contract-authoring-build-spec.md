# Build Spec: AI Contract Authoring in Fabric Studio

**Document status:** Reflects the committed implementation (2026-06-23). Companion to [`HLD-ai-contract-authoring.md`](HLD-ai-contract-authoring.md).
**Audience:** Engineers on `unfurl-ui` (fabric-studio-webapp), `unfurl-fabric` (Studio API), `unfurl-foundry` (the agent platform).
**Upstream context:** existing Studio pipeline (`StudioFabricClient`: `extractNeeds`, intents, `resolveDeployment`, `compileCandidate`, `draftExport`); the foundry agent platform + skill substrate; DCP catalog claims. Master doc §1/§3 (residency / no phone-home), §14 (flow/foundry boundary).

> **History (so the doc isn't read against stale assumptions):** earlier iterations put the
> authoring agent inside `unfurl-foundry` as source, then ran it *in Fabric* via the
> foundry-substrate library with Fabric-side tool reflection. Both were superseded. The
> committed design below is: **foundry runs the agent and owns provider/tool registration;
> Fabric delegates to foundry over DCP `agent.run`.** Ignore any reference elsewhere to
> `FabricAuthoringAgent`, `AuthoringAgentInvocable`, `AuthoringTool`, or
> `unfurl-fabric/sample-authoring-tools` — those were removed.

---

## What This Adds

A conversational entry point in Fabric Studio: the user prompts what they need, an AI **clarifies**, **proposes** a composition (as existing Studio intents) + a deployment, and the user **exports** the **same signed Fabric contract** the visual path produces. It is a front-end onto the existing pipeline, not a new pipeline.

The AI runs **server-side on foundry** (the agent platform) with a customer-configured model. The browser never calls an LLM. Fabric is a thin delegator that turns a converse turn into a DCP `agent.run` invocation to foundry, and maps the result back into a Studio response — falling back to a deterministic in-Fabric bridge when no foundry endpoint is configured.

## Architecture (committed)

```
unfurl-ui (fabric-studio-webapp)        the conversational UI
  apps/fabric-studio-webapp/
    AuthoringConversationPanel.tsx      chat panel: prompt, typed clarifying questions, structured answers, proposal preview
    authoringSession.ts                 turn/state; bridges proposals into the existing draftWorkspace + intents
    authoringNoBrowserModelSdk.test.ts  guard: webapp imports no model SDK, holds no provider key
  packages/fabric-validation-client/    converse client method + mock
        │  POST /studio/authoring/converse  { scope, sessionId, conversation[], userMessage, questionAnswers }
        ▼
unfurl-fabric (Studio API)              thin DCP delegator — depends ONLY on the neutral
                                        substrate-composition-api (no foundry product at runtime)
  StudioAuthoringHandler                the endpoint
  StudioCatalogService.converseAuthoring
    if a ContractInvocable is injected → build an agent.run ContractInvocation
        { userMessage, conversation, questionAnswers, catalog } and call it; map result → StudioAuthoringConverseResponse
    else → deterministic in-Fabric bridge (fallback)
    + grounding guard: re-validate every proposed ADD_COMPONENT against the admitted catalog
  DcpAuthoringClient implements ContractInvocable
    HTTP client to foundry's agent.run; configured from UNFURL_FOUNDRY_DCP_ENDPOINT;
    StudioServer auto-injects it (DcpAuthoringClient.fromEnvironment) via useAuthoringInvocable(...)
        │  HTTP  POST <endpoint>/dcp/agent.run   (neutral ContractInvocation JSON)
        ▼
unfurl-foundry (agent platform)         runs the agent; owns provider + tool registration
  runtime/FoundryDcpServer (+Launcher)  exposes agent.run over HTTP; --deployment-root
  runtime/AgentRunInvocable             generic agent.run ContractInvocable (maps invocation → AgentRuntime.start → result)
  runtime/AgentRunBootstrap             loads tools (DeploymentToolLoader) + DAG (FoundrySubstrateCodec)
                                        + registers a ModelProvider, builds the runtime
  tools/ToolPlugin (SPI) + DeploymentToolLoader + LoadedTools   ServiceLoader over deployment/tools/*.jar
  providers/ModelProviderPlugin (SPI) + DeploymentProviderLoader + LoadedModelProviderPlugins
  providers/FoundryEnvironmentModelProviders + AnthropicModelProvider   key from ANTHROPIC_API_KEY (env)
  deployment/                           agents/fabric-authoring.agent.yaml (DAG), prompts/, tools/*.jar, providers/
  sample-authoring-tools/               reference tool JAR: fabric.catalog-query / needs / intent (ToolPlugins)
```

## The delegation seam (the load-bearing boundary)

- The contract between Fabric and foundry is the **neutral** `com.unfurl.substrate.composition.ContractInvocation` / `ContractInvocationResult` (`agent.run`). **Neither product depends on the other at runtime** — cross-product is DCP only. (Fabric declares `unfurl-foundry` only as a *test*-scope dependency, to stand up a real `FoundryDcpServer` in the end-to-end test.)
- **In-process or over the wire, identical contract:** today `DcpAuthoringClient` speaks HTTP/JSON to `FoundryDcpServer`; a co-packaged host could inject an in-process `ContractInvocable` instead, with no change to Fabric or foundry.
- **Secrets stay in the environment, never in source:** the model key is read from `ANTHROPIC_API_KEY`; foundry's credential-store key from `UNFURL_FOUNDRY_CREDENTIAL_KEY`. The browser holds no key; Fabric holds no key; no key appears in any repo.

## Grounding (defence-in-depth)

The agent composes only from the admitted catalog: the `fabric.catalog-query` tool keeps the model honest, **and** Fabric independently re-validates every proposed `ADD_COMPONENT` against the admitted catalog (`StudioCatalogService.mapAuthoringOutput` → `rejectIntentAgainstCatalog`). An unadmitted component becomes a **gap**, regardless of model/tool output.

## Phases (status reflects committed code)

### Phase 1 — Foundry `agent.run` host   **[IMPLEMENTED]**   *(unfurl-foundry)*
The agent platform runs the DAG and owns provider/tool registration: `FoundryDcpServer` (+ launcher), `AgentRunInvocable`, `AgentRunBootstrap` (loads tools + DAG via codec + registers a provider), the `ToolPlugin`/`ModelProviderPlugin` SPIs + deployment loaders, `AnthropicModelProvider` (env key), and the `deployment/` + `sample-authoring-tools/` artifacts. Foundry stays generic — nothing here knows it is "Fabric authoring"; the authoring DAG/tools/provider are deployment artifacts.
**Tests:** `FoundryDcpServerTest`, `AgentRunInvocableTest`, `AgentRunBootstrapTest`, `DeploymentToolLoaderTest`, `DeploymentProviderLoaderTest`, `AnthropicModelProviderTest`, `FoundryEnvironmentModelProvidersTest`, `ModelProviderPluginTest`.

### Phase 2 — Fabric delegates over DCP   **[IMPLEMENTED]**   *(unfurl-fabric)*
`POST /studio/authoring/converse` (`StudioAuthoringHandler`) → `StudioCatalogService.converseAuthoring`, which builds an `agent.run` `ContractInvocation` `{ userMessage, conversation, catalog }`, routes it through the injected `ContractInvocable` (`DcpAuthoringClient` from `UNFURL_FOUNDRY_DCP_ENDPOINT`), maps the result to `StudioAuthoringConverseResponse`, and re-validates proposals against the catalog. Deterministic bridge fallback when no endpoint is configured.
**Tests:** `DcpAuthoringClientTest`, `StudioCatalogServiceAuthoringDcpTest` (proposal/gap routing, fallback, unadmitted→gap), `FoundryDcpAuthoringEndToEndTest` (Fabric `DcpAuthoringClient` → real `FoundryDcpServer` → scripted-model agent run).

### Phase 3 — Conversational UI panel   **[IMPLEMENTED]**   *(unfurl-ui)*
`AuthoringConversationPanel` + `authoringSession` drive `/studio/authoring/converse`, render typed clarifying questions, send structured `questionAnswers` keyed by question id, preview the proposal, and apply accepted intents into the existing `draftWorkspace`. Select-style options are `{ label, value }` objects: the UI renders labels and sends values. The visual workbench can also seed the same panel from action-scoped controls such as Add, Remove, Replace, Connect, or Substrate configuration; those controls pass `actionContext` so Foundry can ask configuration or impact questions without owning the mutation. `fabric-validation-client` gains the converse method + mock. `authoringNoBrowserModelSdk.test.ts` guards that the webapp makes no model call and carries no key.

### Phase 4 — Wire proposal into resolve/compile/export   **[IMPLEMENTED — reuse]**   *(unfurl-ui)*
The accepted draft flows through the existing steps unchanged: `resolveDeployment` → `compileCandidate({ sign: true, deploymentPolicy })` → `draftExport`. An AI-authored signed contract is identical in shape/trust to a visually-authored one.

### Phase 5 — Export UX   **[IMPLEMENTED — reuse]**   *(unfurl-ui)*
Surface the existing `draftExport` bundle (signed contract + substrate profile + deployment manifest) for download, reusing `renderDraftExportText` / `buildDraftExportBundle`.

### Phase 6 — Runnable deployment artifacts   **[DEFERRED]**   *(unfurl-deploy-emitter)*
Feed the signed `BindingPlan` to deploy-emitter for Helm/raw artifacts. Emit ≠ apply; the Studio never deploys into a customer perimeter itself.

## Definition of Done

- A user authors a valid, signed Fabric contract + deployment from a natural-language prompt + clarifying Q&A, and exports it — the same artifact as the visual path.
- The agent runs server-side on foundry with a customer-configured model; the browser makes no model call and holds no key; no key appears in source.
- Fabric reaches foundry only through the neutral `agent.run` DCP contract; neither product depends on the other at runtime.
- Every proposal is re-validated against the admitted catalog; unmet needs surface as gaps.
- An AI-authored signed contract is indistinguishable in shape/trust from a hand-authored one.

## What this must NOT become

- No browser→LLM and no provider key in the webapp or in Fabric — the agent runs on foundry, keyed from env.
- No Fabric→foundry (or foundry→Fabric) Maven dependency at runtime — only the neutral DCP contract. (Test-scope only, for the e2e.)
- No invented components — proposals are re-validated against the admitted catalog.
- No new contract/deployment format — reuse the signed contract + substrate profile + deployment bundle.
- No auto-apply / auto-deploy — every proposal is human-reviewed; Studio emits, it does not apply into a perimeter.
- No action-assist bypass — contextual Add/Remove/Replace/Substrate help may call the authoring agent, but accepted output still replays the same Studio intents and Fabric validation path.

## Build-order note

Because Fabric's end-to-end test has a *test-scope* dependency on `unfurl-foundry`, a clean build must build/install foundry before Fabric. The root reactor orders them correctly; a standalone `mvn test` in `unfurl-fabric` requires `unfurl-foundry` installed first.
