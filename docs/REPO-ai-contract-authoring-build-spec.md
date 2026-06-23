# Build Spec: AI Contract Authoring in Fabric Studio

**Document status:** Claude-Code-ready build spec. Companion to [`HLD-ai-contract-authoring.md`](HLD-ai-contract-authoring.md).
**Audience:** Claude Code. Self-contained brief for adding a conversational, AI-assisted contract + deployment authoring path to Fabric Studio.
**Architecture correction (2026-06-23):** An earlier slice put the authoring agent + tools as **source inside `unfurl-foundry`** (`com.unfurl.foundry.authoring.*`). That was wrong — it made the generic agent runtime know about a Fabric-specific use case. **That package was reverted; foundry is untouched and stays a generic agent runtime.** The corrected design mirrors flow:
- **The authoring agent is a DAG** — a foundry-substrate `AgentDefinition` (clarify → propose-needs → propose-composition), a **deployment artifact** (`unfurl-fabric/deployment/agents/fabric-authoring.agent.yaml`), not Java source. The AI peer of a flow `WorkflowDefinition`.
- **The tools are client-supplied JARs** in `deployment/tools/*.jar`, each implementing the `AuthoringTool` SPI (`name()` + a foundry-substrate `ToolExecutor`) and declared via `META-INF/services`. **Fabric discovers them by reflection** — `DeploymentToolLoader` scans the folder, loads each JAR in an isolated `URLClassLoader`, and `ServiceLoader`s the tools; Fabric never compiles against the tool impls. Returned as a closeable `LoadedAuthoringTools` (the class loader lives for the runtime's lifetime).
- **It runs in Fabric via the foundry-substrate *library*** (`EmbeddedAgentRuntime` + the customer `ModelProvider` + the loaded tools) — Fabric depends on `foundry-substrate-*` (the neutral AI substrate), never on the `unfurl-foundry` product.

**Landed (this correction):** foundry revert; `AuthoringTool` SPI + `DeploymentToolLoader` + `LoadedAuthoringTools` (tested faithfully — `DeploymentToolLoaderTest` compiles an external tool JAR at test time and loads it by reflection, 2 tests); the reference `deployment/` folder (DAG YAML + prompt + `tools/` convention + README). Full fabric suite green (201 tests). The generic DCP `ContractInvocable` seam in `StudioCatalogService` (`useAuthoringInvocable` + `converseAuthoring` routing, deterministic fallback) stays.

**Assembly (landed):** Fabric `AuthoringAgentInvocable implements ContractInvocable` runs the DAG on the neutral `EmbeddedAgentRuntime` and reshapes the terminal phase output to the `{kind, assistantMessage, proposal|questions|unmet}` result. Host adapters `SingleModelProviderRegistry` (wraps the customer `ModelProvider`) and `MapToolRegistry` (wraps the reflected `LoadedAuthoringTools`) bridge the loaded artifacts to the substrate ports; `AuthoringAgentInvocable.create(contractId, version, agent, model, tools)` assembles it. A host injects it via `StudioCatalogService.useAuthoringInvocable(...)`, replacing the deterministic bridge with the real DAG run. `AuthoringAgentInvocableTest` proves it end-to-end: a real runtime runs the DAG over a deployment tool + a scripted model (tool-call loop included), and Fabric's `converseAuthoring` routes the result to a `StudioAuthoringConverseResponse`. Full fabric suite green (203 tests).

**Grounding guard (landed):** Fabric re-validates every proposed `ADD_COMPONENT` against the admitted catalog (`rejectIntentAgainstCatalog`) in `mapAuthoringOutput` before returning a proposal — an unadmitted component becomes a gap regardless of model/tool output. Defence-in-depth alongside the `fabric.catalog-query` tool. Tested (`StudioCatalogServiceAuthoringDcpTest.rejectsProposalWhoseComponentIsNotAdmittedInTheCatalog`).

**Reference tool JARs (landed):** `unfurl-fabric/sample-authoring-tools/` — a standalone module building a thin JAR with `fabric.catalog-query` / `fabric.needs-emitter` / `fabric.intent-emitter` (no-arg `AuthoringTool` impls, `provided`-scope SPI deps, `META-INF/services` declaration). `SampleAuthoringToolsTest` verifies the SPI + executors; `DeploymentToolsIntegrationTest` loads the **real built JAR** from `deployment/tools/` by reflection and asserts all three tools resolve (skipped if the JAR is absent). The JAR is the template clients copy.

**Remaining (productionization):** load the DAG/prompt from `deployment/agents` + `deployment/prompts` via the foundry-substrate codec at host startup (the assembly test builds the `AgentDefinition` programmatically), and bind the customer `ModelProvider` from a runtime profile.
**Upstream context:** existing Studio pipeline (`StudioFabricClient`: `extractNeeds`, intents, `resolveDeployment`, `compileCandidate`, and `draftExport`); foundry agent runtime + skill substrate; DCP catalog claims. Master doc §1/§3 (residency / no phone-home).

---

## What This Adds

A conversational entry point in Fabric Studio: the user prompts what they need, a **server-side foundry agent** clarifies requirements, proposes a composition (as existing Studio intents) and a deployment, and the user exports the **same signed Fabric contract** the visual path produces. It is a front-end onto the existing pipeline, not a new pipeline. See the HLD for rationale, the residency constraint, and boundaries.

## Cross-Repo Layout

```
unfurl-foundry/                         UNTOUCHED — generic agent runtime + the agent.run ContractInvocable
                                         (AgentInvocation). Knows nothing about Fabric authoring.

unfurl-fabric/  (Studio API + host)     reads tools by reflection; runs the DAG via foundry-substrate
  deployment/                           CLIENT-SUPPLIED artifacts (not Fabric/foundry source):
    agents/fabric-authoring.agent.yaml    the authoring AgentDefinition DAG
    prompts/fabric-authoring.md           system prompt
    tools/*.jar                           client tool JARs (AuthoringTool SPI, ServiceLoader)
  studio/authoring/
    AuthoringTool.java                    SPI a client tool JAR implements (name + ToolExecutor)
    DeploymentToolLoader.java             scans deployment/tools, URLClassLoader + ServiceLoader
    LoadedAuthoringTools.java             closeable holder (owns the tool class loader)
    AuthoringAgentInvocable (remaining)   builds EmbeddedAgentRuntime over loaded tools + DAG, as agent.run
  StudioCatalogService                  POST /studio/authoring/converse; injectable ContractInvocable seam
                                         (useAuthoringInvocable), deterministic fallback

unfurl-ui/  (fabric-studio-webapp)      the conversational UI
  packages/fabric-validation-client/    + authoring client methods (converse, applyProposal)
  apps/fabric-studio-webapp/
    AuthoringConversationPanel.tsx      chat-style panel: prompt, typed clarifying questions, proposal preview
    authoringSession.ts                 turn/state model; bridges proposals into draftWorkspace + intents
    (reuse) deploymentPlanner, draftExport, draftWorkspace
```

## Dependencies & Forbidden Imports

- **No browser→LLM.** The webapp never imports a model SDK or holds a provider key; it only exchanges conversation turns + structured proposals with the Studio API. CI/lint guards the webapp against model-SDK imports.
- **The agent runs on foundry**, using a customer-configured provider via the `ProviderRegistry`; provider SDKs stay in foundry `adapters/` (per the foundry build spec), not in fabric or the UI.
- **AI proposals flow through the existing `StudioFabricClient`** intent/validation path — no new bypass client, no direct contract mutation from the agent.
- The agent depends on the **DCP catalog** (claims/offers) for grounding; it imports no `unfurl-flow` internals (cross-product is DCP only).

## Out of Scope (first slice)

- Runnable deployment artifacts (Helm/raw) — that is `unfurl-deploy-emitter` (BindingPlan → artifacts); this slice exports the signed contract + deployment plan.
- A new contract or deployment *format* — AI authoring reuses the existing signed Fabric contract + substrate profile + deployment bundle.
- Autonomous/unattended authoring — every proposal is human-reviewed; the agent proposes, the user disposes.
- Multi-tenant authoring history/persistence beyond the existing draft session model.

---

## Phased Build Plan

### Phase 1 — The authoring agent + skill   **[IMPLEMENTED — model-driven agent + grounded tools; AgentDefinition-DAG run optional]**   *(unfurl-foundry)*

Implemented `com.unfurl.foundry.authoring.FabricAuthoringAgent`: a model-driven converse engine (system prompt at `resources/prompts/fabric-authoring.md`) that classifies a turn as clarify/propose/gap and names a catalog capability; the grounded SDK-free tools `CatalogQueryTool` / `NeedsEmitterTool` / `IntentEmitterTool` re-check the capability against the catalog and emit the needs spec + `ADD_COMPONENT` intents. The `fabric-authoring@1.0.0` skill declares the budget/permission/tool bundle. Tested by `FabricAuthoringAgentTest` (clarify, grounded propose, grounding-guard gap, model-reported gap, unparseable→clarify).

Optional follow-on: run the converse through the full `AgentDefinition` phase-DAG on `DurableAgentRuntime` (so skill budget/permission are enforced by the runtime guardrail/permission-bridge rather than at the converse boundary). Today the agent calls the `ModelProvider` directly and grounds in code; the original design below describes the DAG form.

Define a `fabric-authoring` `AgentDefinition` (multi-phase: **clarify → propose-needs → propose-composition**, joined by conditional edges) and a `fabric-authoring.skill.yaml` `SkillDefinition` bundling the agent's tools (catalog-query, needs emitter, intent emitter) with a budget cap and permission scope. Tools are **grounded and SDK-free**: catalog-query reads admitted DCP claims/offers; the emitters produce structured `suggestedNeedsYaml` and Studio intent lists. The agent composes only from catalog components.

**Acceptance:** given a catalog fixture and a prompt, the agent (run through `EmbeddedAgentRuntime`/`DurableAgentRuntime` with a stub provider) emits typed clarifying questions, then a needs spec, then a valid intent list referencing only catalog components; an unsatisfiable need yields a gap, not an invented component. Governed by the skill's budget/permission (reuses the skill enforcement tests' pattern).

### Phase 2 — Studio authoring endpoint   *(unfurl-fabric)*

Add `POST /studio/authoring/converse`: turn-based, stateless-per-call over a draft session. Input: `{ scope, sessionId, conversation[], userMessage }`. It runs the foundry authoring agent server-side, grounded in the session's admitted catalog, and returns one of: `{ kind: "clarify", questions[] }`, `{ kind: "proposal", needsYaml, intents[], deploymentPolicy }`, or `{ kind: "gap", unmet[] }`. Proposed intents are **validated through the existing draft/intent path** before being returned (so an invalid proposal never reaches the UI as applyable).

**Acceptance:** a converse call with a clear prompt returns a proposal whose intents all validate against the draft; a vague prompt returns clarifying questions; a request for an uncatalogued capability returns a gap; the model provider is resolved server-side (no key in request/response).

### Phase 3 — Conversational UI panel   *(unfurl-ui / fabric-studio-webapp)*

Add `AuthoringConversationPanel.tsx` + `authoringSession.ts`: a chat-style panel that drives `/studio/authoring/converse`, renders typed clarifying questions (single/multi-select, free-text), and shows the proposal (needs + components + wiring + deployment) as a reviewable preview. Add client methods to `fabric-validation-client` (`converse`, and an `applyProposal` that replays the proposed intents through the **existing** `StudioFabricClient`).

**Acceptance:** a user prompts, answers clarifying questions, and sees a proposal; accepting it applies the intents into the existing `draftWorkspace` (visible in the visual editor); the user can edit or ask for a revision; the webapp makes no model call and carries no provider key.

### Phase 4 — Wire proposal into resolve/compile/export   *(unfurl-ui, reuse)*

The accepted draft flows through the **existing** steps unchanged: `resolveDeployment` → `compileCandidate({ sign: true, deploymentPolicy })` → `draftExport`. The agent's proposed `deploymentPolicy` seeds the deployment planner; the user can adjust before resolving.

**Acceptance:** an AI-authored draft resolves a deployment and compiles to a `signedContractArtifact` identical in shape/trust to a visually-authored one; the deployment planner reflects the agent's suggested target and remains user-editable.

### Phase 5 — Export UX   *(unfurl-ui, reuse)*

Surface the existing `draftExport` bundle (signed contract YAML + substrate profile + deployment manifest) in the panel with a download/copy action, reusing `renderDraftExportText`/`buildDraftExportBundle`.

**Acceptance:** the user exports the AI-authored contract bundle; the exported signed contract validates against the DCP schema exactly as a hand-authored export does.

### Phase 6 — Runnable deployment artifacts (DEFERRED)   *(unfurl-deploy-emitter)*

When deploy-emitter lands, add an "export runnable deployment" action that feeds the signed `BindingPlan` to deploy-emitter and offers the emitted Helm/raw artifacts. Emit ≠ apply; the Studio never deploys into a customer perimeter itself.

**Acceptance (when built):** the desired deployment exports as runnable artifacts a customer can apply in their own perimeter.

---

## Build Order Summary

1. Authoring agent + `fabric-authoring` skill *(foundry)*
2. `/studio/authoring/converse` endpoint *(fabric)*
3. Conversational UI panel + client methods *(ui)*
4. Wire proposal → resolve/compile/export *(ui, reuse)*
5. Export UX *(ui, reuse)*
6. *(deferred)* runnable artifacts via deploy-emitter

## Definition of Done

- A user authors a valid, signed Fabric contract + deployment entirely from a natural-language prompt + clarifying Q&A, and exports it.
- The authoring agent runs server-side on foundry with a customer-configured provider; the browser makes no model call and holds no provider key.
- Every AI proposal is validated and signed through the existing Fabric pipeline; an AI-authored signed contract is indistinguishable in shape/trust from a hand-authored one.
- The agent composes only from admitted catalog components; unmet needs surface as gaps.
- The agent run is governed by the `fabric-authoring` skill's budget/permission.

## Testing Strategy

- Agent tests (foundry): clarify-vs-propose branching, needs/intent emission against a catalog fixture, gap on uncatalogued capability, governance via the skill.
- Endpoint tests (fabric): proposal intents validate against the draft; vague prompt → clarify; uncatalogued → gap; provider resolved server-side; no key in payloads.
- UI tests (webapp): panel renders typed questions and proposal; accept applies intents into `draftWorkspace`; revision loop; **a guard test asserting the webapp bundle contains no model-SDK import / no provider key**.
- End-to-end: prompt → clarify → propose → resolve → compile(sign) → export; assert the exported signed contract is schema-valid and equal in shape to a visually-authored one for the same needs (reuse a `*-needs.yaml` fixture).

## What Claude Code Must Not Do

- Do NOT call an LLM from the browser or put a provider key in the webapp — the agent runs server-side on foundry.
- Do NOT let the AI bypass Fabric validation/signing — proposals go through the existing intent/compile path; the AI is not a new trust path.
- Do NOT invent a new contract or deployment format — reuse the existing signed contract + substrate profile + deployment bundle.
- Do NOT let the agent propose components not in the admitted catalog — unmet needs are gaps.
- Do NOT build the deploy-emitter runnable-artifact export in this slice — export the signed contract + deployment plan; runnable artifacts are deferred to deploy-emitter.
- Do NOT auto-apply or auto-deploy — every proposal is human-reviewed; Studio emits, it does not apply into a customer perimeter.
