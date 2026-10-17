import { it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { localHostRuntime } from "./hostRuntime.js";
import { createHostRegistry } from "./registry.js";
import { loadWebapp } from "./MicroAppHost.js";

it("blocks a direct protected route and removes its navigation without host grants", () => {
  const local = localHostRuntime("tenant-a");
  const runtime = { ...local, context: { ...local.context, user: { id: "reader", roles: [], permissions: [] } } };
  const html = renderToString(<MemoryRouter initialEntries={["/components/fabric-studio/catalog"]}><AppShell runtime={runtime} /></MemoryRouter>);
  assert.match(html, /Access denied/); assert.doesNotMatch(html, /href=.*catalog/);
});

it("applies host theme tokens and reports incompatible deployed components", () => {
  const local = localHostRuntime("tenant-a");
  const runtime = { ...local, baseTheme: { id: "custom", name: "Custom", tokens: { background: "#123456" } } };
  const html = renderToString(<MemoryRouter><AppShell runtime={runtime} /></MemoryRouter>);
  assert.match(html, /--background:#123456/);
});

it("rejects an unapproved module before import", async () => {
  const local = localHostRuntime("tenant-a");
  const registered = createHostRegistry(local.registry).apps[0]!;
  await assert.rejects(loadWebapp({ ...registered, bundleUrl: "https://untrusted.invalid/module.js" }, []), /Unapproved/);
});
