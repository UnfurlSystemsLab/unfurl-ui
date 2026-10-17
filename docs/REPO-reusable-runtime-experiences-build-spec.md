# Reusable runtime experiences build plan

Status: design only. No implementation or package extraction is authorized by this
document. [HLD](HLD-reusable-runtime-experiences.md) owns the model and
[LLD](LLD-reusable-runtime-experiences.md) owns proposed implementation semantics.

## Layering and existing reuse

Reuse host registry, compatibility validation, micro-app props, event bus and theme
mediation before adding seams. Extend `design-system` deliberately: its current
token types do not establish ready-made chat or settings controls. Review Studio's
table, audit and advisor patterns for reusable behavior without importing app code
into shared packages or routing runtime conversations through Studio authoring.

Dependency direction: apps -> feature packages / injected client ports -> existing
shared contracts and design primitives. Domain presentation -> shared feature APIs
and published domain schema projections. Product transport adapters implement ports
but do not leak wire DTOs into generic components. No shared package imports apps,
broker SDKs or backend implementation classes. Frontend modules never contain broker
session documents or signing keys.

## Delivery sequence

| Wave | Deliverables | Acceptance gate |
| --- | --- | --- |
| 0 inventory and contract fit | Map actual Foundry conversation API and remote binding, host management services, reusable Studio controls, adapter schemas and extension lifecycle | Per-operation availability matrix, backend owner and version for each feature. Proposed names must not be mistaken for implemented APIs. |
| 1 feature contracts and primitives | Versioned companion descriptor, approved registry, renderer/settings ports and accessible base controls | Legacy manifest compatibility, deterministic registration, duplicate/schema/version rejection, package dependency checks and disabled-feature removal |
| 2 chat experience | `conversation-ui`, `foundry-client`, hosted/standalone chat app, scoped history and truthful lifecycle | Real neutral-service integration, reconnect/gap handling, uncertain submission recovery, cancellation races and account/logout cleanup |
| 3 settings and operations | `settings-ui`, owner-specific management clients, operations app and personal/account sections | Revision conflicts, validate/apply drift, ambiguous apply status, secret-reference behavior and activation-state reporting |
| 4 Kotak read presentation | Optional holdings/MTF/GTT renderers and account-status section | Exact schema projection, decimal/unknown/coverage parity, no broker requests from browser, no writes, supported live-read evidence separately recorded |
| 5 governance and approvals | Audit/usage/budget/health views, scoped export, generic approval components | Backend tenant denial, expiring intent review, stale decisions, cost estimate/actual handling and audited management changes |
| 6 trading contribution | Exact trade/GTT review only after backend write capability qualification | Approved parameter digest, revocation/expiry, ambiguous dispatch reconciliation, no duplicate execution and independently authorized live acceptance |

Backend management contract additions belong to their owning repos and require their
HLD/LLD/build-spec updates before wiring UI clients. A missing backend does not justify
a successful fake save. Synthetic fixtures are limited to explicitly identified tests
or development previews and never silently replace a failed production service.

## Validation and deployment

Run workspace typecheck and tests for implemented slices, plus dependency/layering
checks. Browser tests cover keyboard use, narrow/wide screens, themes, errors,
two tenants/accounts, stream reconnect, logout and stale event races. Wire integration
tests to actual supported service contracts with deterministic providers; distinguish
these from real model/broker and external-client certification.

Deploy only host-approved pinned bundles with compatible descriptor and backend
versions. Keep current apps valid when new features are absent. Test removal of
Kotak, governance and approval packages separately without breaking generic chat.
Rollback a UI release without rolling back accepted server work; preserve history
and clearly disable unsupported controls after rollback. Record telemetry drops and
backend contract mismatches without recording private content.

## Definition of done for this design

Ownership, proposed extension fields, neutral ports, user lifecycle, security,
failure semantics, account scoping and rollout gates are specified. Implementation
requires a separate request. No claim of live chat, settings or trade support follows
from these documents. See the adapter's
[governance rollout](../../unfurl-adapter-kotak-neo/docs/PLAN-governance-setup.md)
for the corresponding operational prerequisites.
