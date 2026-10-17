# Host runtime and Studio isolation remediation

Status: implementation design. This extends the host-shell HLD and Studio LLD.

The runnable shell must consume its validated manifest registry, enforce route
visibility using host permissions, resolve theme tokens and mount independent app
lifecycle modules. Deployment configuration supplies an approved import map and
trusted host identity/token port. The built-in Studio is a bundled lifecycle module;
additional approved apps use the same mounting contract. Failures are isolated to
the selected app with explicit retry. Browser code cannot establish backend grants.
Standalone Studio bootstrap uses the same app and client port.

The default local development profile remains explicitly labeled local development,
with same-origin HTTP and no fabricated authentication. An injected authenticated
host profile supplies tenant, user, permissions and an asynchronous access-token
provider. HTTP requests resolve tokens at dispatch time and never put them in URLs.
Missing tokens fail before dispatch. No secret or token is persisted by the UI.

Workspace scope changes remount the complete tenant/assembly subtree. Scope inputs
are drafts until applied, preventing old session/components/history from being
persisted or submitted under an edited scope. Authoring also resets on its full
tenant/assembly/session/catalog identity; late completions cannot update a new scope.

Session snapshots from reads and heartbeat are accepted only when tenant, assembly,
session identity match and sceneRevision does not decrease. Use periodic authenticated
snapshot reconciliation with bounded frequency and no overlapping requests; errors
are visible and retry on the next interval. Do not depend on unauthenticated native
EventSource for bearer-authenticated sessions. Teardown cancels updates, not backend work.

Intent and diff views require authoritative inputs. When the current API cannot supply
them, render an explicit unavailable state without sample records or fake hashes.
Fixture-only previews may be explicitly enabled. Missing admission support never
produces VERIFIED. Future historical APIs remain owned by Fabric rather than simulated.

Regression gates cover scope remounts, authoring races, stale and foreign snapshots,
transient reconciliation errors, per-request token refresh, denied routes, manifest
compatibility, lifecycle failure/unmount and unavailable live history/diff/admission.
