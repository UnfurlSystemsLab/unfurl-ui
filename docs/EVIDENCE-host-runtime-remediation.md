# Host runtime remediation evidence

Date: 17 October 2026. Local implementation verification, not production certification.

## Completed gates

- `npm test`: completed successfully, including the forced TypeScript project build.
- Direct compiled Node test gate: 191 tests passed, zero failures or skips.
- `npm run build:studio`: production bundle built successfully with a separate
  lazy-loaded Studio lifecycle chunk.
- `npm run test:browser:host`: Playwright Chromium gate passed. An owned Vite process
  starts on port 5187 and closes after the gate.
- Local documentation links and `git diff --check`: passed.

Interactive browser checks verify that a staged tenant edit does not write the old
inventory to the other tenant; applying scope restores that tenant's own cached
components. Live history and diff routes display unavailable rather than generated
records. A second explicitly approved test webapp mounts from a deployment manifest
and unmounts when navigating back to Studio. The authenticated test host's theme is
applied, and its bearer credential reaches Studio API requests without appearing in
URLs. The ordinary local shell rendered without page errors during navigation.

Targeted interactive and transport tests verify that delayed authoring completions
cannot populate a replacement scope, missing claim admission cannot produce VERIFIED,
denied routes do not mount apps, unapproved bundles are rejected before import, and
credentials are reacquired for each request. Session tests reject foreign/regressing
snapshots and cover transient failure, recovery and pending completion after stop.

## Scope and limitations

Browser network responses and deployment credentials are explicitly synthetic test
fixtures. No real IdP, live broker session, customer account, trade or model request
was used. Backend authorization and deployment-owned token acquisition still require
the actual host integration. The UI does not supply an identity provider.

Fabric historical-intent and revision-artifact route integrations are not invented
in this change. The existing live views report that those sources are unavailable;
renderers can accept authoritative inputs, and fixture previews remain clearly marked.
This corrects misleading display behavior without claiming new backend operations.

The new runtime chat/settings feature packages remain a separate design workstream.
These changes repair existing Studio and host wiring rather than implementing that
new product scope. Audit, signing, compilation and broker admission remain backend-owned.
