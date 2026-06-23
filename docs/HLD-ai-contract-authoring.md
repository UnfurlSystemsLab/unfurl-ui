# High-Level Design: AI Contract Authoring in Fabric Studio

**Document status:** Design doc. Proposes a conversational, AI-assisted path to author a composition contract + deployment in Fabric Studio, layered on the existing Studio pipeline. Companion build spec: [`REPO-ai-contract-authoring-build-spec.md`](REPO-ai-contract-authoring-build-spec.md).
**Audience:** Engineers on `unfurl-ui` (fabric-studio-webapp), `unfurl-fabric` (Studio API), and `unfurl-foundry` (the authoring agent).
**Upstream context:** `HLD-D-fabric-ui-host-shell.md`, `LLD-unfurl-studio-visual-composition.md` (the existing Studio). Product master doc §1 (residency wedge / no model in the perimeter unless customer-configured), §3 (no phone-home), §14 (flow/foundry boundary). foundry agent + skill substrate (the authoring agent runs here).

---

## The goal

Today a user authors a contract in Fabric Studio **visually**: pick components from the catalog, wire ports, resolve a deployment, compile, and export a signed Fabric contract. This is precise but expert-facing.

We want a second, **conversational** entry point: the user types *what they need* in natural language ("a chatbot that answers from our docs and escalates to a human"), an AI **clarifies the requirements**, proposes a **composition contract and a deployment**, and the user **exports** it — the same signed artifact the visual path produces.

## The key realization: this is a front-end onto the existing pipeline

The Studio already has the entire authoring→export pipeline behind the `StudioFabricClient`:

```
extractNeeds ─► compose via intents ─► resolveDeployment ─► compileCandidate (sign) ─► draftExport
(needs YAML)    (AddComponent /         (deployment shape    (signed Fabric           (signed contract +
                ConnectPorts /           selections)          contract artifact)       substrate profile +
                ReplaceComponent)                                                       deployment bundle)
```

AI authoring does **not** add a parallel pipeline. It adds a conversational layer that **produces the same inputs the visual path produces** — a needs spec and a sequence of Studio intents — and then drives the *existing* resolve/compile/export steps. Fabric remains the single source of truth: it validates every proposed intent and signs the contract exactly as it does for hand-authored drafts.

## Where the AI runs (and where it must not)

The authoring AI is a **foundry agent** invoked **server-side** through a new Studio API endpoint — **never a browser→LLM call**. This is non-negotiable for the product posture:

- **Residency / no phone-home (master doc §1, §3):** the model provider is the customer's own configured provider (resolved through foundry's `ProviderRegistry`); no model SDK or provider key ever reaches the browser, and Studio makes no vendor callback.
- **Grounding:** the agent is grounded in the **admitted component catalog** — the DCP claims/offers and negotiation surfaces the Studio already holds. It composes *only* from real catalog components; it cannot invent a component or capability.
- **Governance:** because it is a foundry agent, the authoring run is governed by budget and permission like any other (and is a natural consumer of the **skill substrate** — a `fabric-authoring` skill bundles the catalog-query and intent-proposal tools with a budget cap and permission scope).

## The conversational contract (structured, not freeform)

The agent's turns are **structured**, so they are machine-checkable and drive the existing pipeline directly:

1. **Clarify.** Given the user's prompt and the catalog, the agent either asks **clarifying questions** (typed: single-select, multi-select, free-text) or signals it has enough to propose.
2. **Propose needs.** The agent emits a **needs spec** in the existing `suggestedNeedsYaml` shape (the same shape as the `*-needs.yaml` e2e fixtures) — the structured statement of what the app requires.
3. **Propose composition.** The agent emits a sequence of existing Studio **intents** (`AddComponent`, `ConnectPorts`, …) that realize the needs against the catalog. Each intent is applied through the existing `StudioFabricClient`, so **all existing Fabric validation and compatibility checks run** — an AI proposal that doesn't validate is rejected the same way a manual one would be.
4. **Propose deployment.** The agent suggests a `deploymentPolicy` / target; `resolveDeployment` produces the concrete shape selections.
5. **Compile + export.** `compileCandidate(sign: true)` produces the signed contract + substrate profile; `draftExport` bundles it for download.

At every step the user stays in control: they can accept, edit (drop into the visual editor), or ask the agent to revise. The agent proposes; the human disposes; Fabric validates.

## Export

Export reuses the existing `draftExport` bundle — **the signed Fabric contract YAML + substrate profile + deployment manifest** — so an AI-authored contract is byte-for-byte the same kind of artifact as a visually-authored one. There is no "AI contract" format.

**Future (deferred):** turning the *desired deployment* into **runnable** artifacts (Helm charts / raw manifests) is `unfurl-deploy-emitter`'s job — it takes the signed `BindingPlan` and emits deployable artifacts (emit ≠ apply). AI authoring produces the signed contract + deployment plan today; the runnable-artifact export is the deploy-emitter extension, not part of this slice.

## Boundaries — what this must not do

- **No browser→LLM, ever.** The agent runs server-side on foundry with a customer-configured provider. The browser only exchanges conversation turns and structured proposals with the Studio API.
- **The AI cannot bypass Fabric.** Every proposed intent goes through the same validation/compatibility/negotiation path as a manual edit; the contract is signed by the same compile path. The AI is an authoring convenience, not a new trust or signing path.
- **No invented components.** The agent composes only from admitted catalog claims; an unsatisfiable need surfaces as a gap ("no catalog component offers X"), not a hallucinated component.
- **Same artifact, same trust.** An AI-authored signed contract is indistinguishable in shape and trust tier from a hand-authored one.
- **The browser holds no secrets.** Provider credentials and catalog trust live behind the Studio API / foundry, not in the webapp.

## Why this shape

- It reuses the entire existing pipeline (needs → intents → resolve → compile → export); the new surface is conversational, not architectural.
- It keeps the model in the perimeter and the trust in Fabric — the two load-bearing product invariants.
- It composes the pieces we already built: foundry agents (the runtime), the skill substrate (a `fabric-authoring` skill), and the DCP catalog (grounding) — each used for exactly its purpose.
