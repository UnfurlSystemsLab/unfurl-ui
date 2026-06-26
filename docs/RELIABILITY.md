# Reliability Notes: unfurl-ui

UI reliability means preserving operator intent clearly while Fabric remains authoritative.

## Expectations

- Studio should recover by reloading catalog, assembly, session, and layout state from the API.
- Event streams are update channels, not the source of truth.
- Build and typecheck should pass across all workspaces.
- Visual state should degrade gracefully when 3D assets or dynamic projections are unavailable.
- Tests should cover route wiring, client contracts, and key panel rendering paths.

