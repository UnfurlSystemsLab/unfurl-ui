# Security Notes: unfurl-ui

`unfurl-ui` hosts the browser-facing Studio and shell surfaces. The UI should never be the source of contract truth.

## Guidance

- Treat all API responses, visual manifests, and uploaded artifacts as untrusted until Fabric validates them.
- Keep provider keys and local `.env` files out of source.
- Do not let layout state define contract validity.
- Use tenant and user context from the host shell when calling Fabric.
- Avoid logging sensitive prompts, uploaded content, or generated contracts in browser consoles.

