# Host runtime remediation build specification

The [remediation LLD](LLD-host-runtime-gap-remediation.md) defines behavior. Existing
host-shell and Studio HLD/LLD remain authoritative for product ownership.

## Implementation ownership

Studio owns `StudioRoutes`, `StudioClientContext`, deterministic development fixtures
and its `bootstrap`/`mount`/`unmount` lifecycle module. Host legacy entry points re-export
those APIs for compatibility. The shell owns registry selection, route permission
guards, theme resolution, approved bundle loading, error presentation and lifecycle
teardown. It uses single-spa root parcels as its route-selected mounting mechanism;
it does not maintain a second application router in single-spa.

Shared `fabric-validation-client` consumes an optional host token-acquisition port.
Every authenticated request obtains a fresh token within its timeout boundary and
checks cancellation before network dispatch. No identity provider SDK is introduced.
Explicit local-development mode keeps existing same-origin development usable and
is visibly unauthenticated. A production build requires deployment-supplied host
configuration, with authenticated or deliberately selected local-development policy.

Workspace scope selection is applied atomically by replacing the full state subtree.
Authoring resets independently on tenant, assembly, catalog and session identity.
Snapshot reconciliation uses matching identity and monotone revisions; the authenticated
client polls without overlap and retries after transient failure. Polling does not
create a new session, replay an intent or cancel accepted work on teardown.

## Acceptance

- TypeScript project build and all compiled tests pass.
- Interactive tests cover delayed authoring responses across scope changes and
  unavailable admission/history/diff states.
- Transport tests cover token rotation and denied dispatch when credentials are empty.
- Session tests cover wrong identities, regressing revisions, transient failure,
  reconnection and teardown during pending reads.
- Headless browser gate covers workspace cache isolation, live data honesty,
  manifest-selected independent mount/unmount, host theme application and bearer auth.
- Production bundle build succeeds; no localhost broker, live trading, or real IdP
  certification is implied by deterministic browser and transport fixtures.

Historical intent and revision artifact APIs remain Fabric-owned prerequisites.
The live routes expose their absence explicitly; supplied authoritative history/diff
view models can be rendered without sample data. Interactive undo/redo in the fixture
preview is labeled as local-only and never represented as a server-side mutation.
