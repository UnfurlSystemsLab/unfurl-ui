# Host deployment and authentication

The host shell selects enabled component manifests through the existing registry,
checks interface compatibility and permissions, resolves the active theme, and mounts
the selected app through single-spa lifecycle functions. Studio owns its internal
routes; other apps contribute their navigation through manifests.

## Development and production

`npm run dev:studio` uses an explicitly labeled unauthenticated local development
profile. It is suitable for the local Lab backend, not proof of production identity.
The existing Vite Studio API base URL and mode environment options remain product
configuration. Fixture previews require explicit fixture mode.

Production must initialize `window.unfurlHost` before loading the module entry point.
The exported `HostRuntime` type in `apps/host-shell/src/hostRuntime.ts` defines the
required configuration. No production profile is fabricated when it is absent.

The deployment bootstrap supplies:

- Exact approved component manifests, import map entries and enabled component IDs.
- `authentication` as `authenticated`, verified tenant/user display context, and
  permission hints from the host identity integration. Backends revalidate authority.
- `context.auth.getAccessToken`, an asynchronous host-owned credential acquisition
  function. Resolve each token at request dispatch, not in a serialized config file.
- Platform and component API bases compatible with the host's CORS/reverse-proxy policy.
- Base theme, theme policy and a host event bus. Tokens are applied to the shell root
  and passed to mounted apps; component-specific visuals consume their declared tokens.
- `approvedBundleUrls`, exact deployment-approved HTTP(S) module URLs. An import map
  entry alone is insufficient to permit remote execution. Bundles run as trusted
  same-origin code; this mechanism is not an untrusted extension sandbox.

The built-in Studio import-map target is `bundled:studio`, reserved for the
`fabric-studio` component ID. Other entries export `bootstrap`, `mount` and `unmount`.
They receive `UnfurlMicroAppProps` plus `domElement`; asynchronous unmount is awaited
against an independently owned child node. Removing or denying an app prevents its
mount. Failed loads have retry and do not remove the shell navigation.

Do not put tokens in URLs, local storage, import maps, HTML configuration or the event
bus. Native EventSource is not used for authenticated Studio session updates; bounded
authenticated snapshot reads reconcile state and recover after transient disconnects.

## Verification

Run `npm test` and `npm run build:studio`. For the interactive browser gate run
`npm run test:browser:host` with Playwright Chromium installed. It starts and closes
an owned local Vite server on port 5187 and uses clearly synthetic test services.
No customer credentials or broker requests are used.

Live Intent History and Visual Diff currently require authoritative Fabric sources
not exposed through their existing route wiring. They report unavailable rather than
inventing validated records. Fixture previews are explicitly labeled; they are not
an undo/redo API for a real session.
