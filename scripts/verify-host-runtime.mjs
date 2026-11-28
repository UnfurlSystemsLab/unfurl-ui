import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = "http://127.0.0.1:5187";
const server = spawn(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5187", "--strictPort"],
  { cwd: resolve("apps/host-shell"), windowsHide: true, stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Test server exited, check that port 5187 is free");
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Startup race only. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, "Test server did not start");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const [tenant, label] of [["tenant-a", "Private A"], ["tenant-b", "Private B"]]) {
      localStorage.setItem(`unfurl-studio-draft-inventory:${tenant}:assembly-one`, JSON.stringify({
        components: [{ catalogEntryId: "com.unfurl:storage:1.0", label, status: "ADDED" }]
      }));
    }
  });
  // Fabric's list answers are arrays: the tenant's files and its deployment environments (P2d), none here.
  await page.route("**/studio/**", route => route.fulfill({ json: /\/files|\/deployment-environments/.test(route.request().url()) ? []
    : route.request().url().includes("/catalog") ? { catalogHash: "hash", entries: [] } : { nodes: [], edges: [], warnings: [] } }));
  await page.goto(`${base}/components/fabric-studio/workspace?tenantId=tenant-a&assemblyId=assembly-one`);
  await page.getByRole("button", { name: "Apply workspace scope" }).waitFor();
  assert.match(await page.locator("body").innerText(), /Private A/);
  await page.getByLabel("Tenant", { exact: true }).fill("tenant-b");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("unfurl-studio-draft-inventory:tenant-b:assembly-one")).components[0].label), "Private B");
  await page.getByRole("button", { name: "Apply workspace scope" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Private B"));
  assert.doesNotMatch(await page.locator("body").innerText(), /Private A/);
  // Studio's navigation is the workbench, catalog and help (HLD-D §6.2).
  const studioLinks = await page.locator("nav a[href^='/components/fabric-studio/']")
    .evaluateAll(links => links.map(link => new URL(link.href).pathname.split("/").pop()));
  assert.deepEqual(studioLinks, ["workspace", "catalog", "help"]);
  // Views the composition has no data for are listed with their reason, never shown empty (Studio LLD §5.1).
  await page.getByText("More views", { exact: true }).click();
  // With no draft open, Data & State says it reads the open draft session (Studio LLD §3.2, P2b typed views).
  await page.locator(".workbench-subbar li", { hasText: "Data & State" })
    .getByText("reads the open draft session; start or open a draft.", { exact: false }).waitFor();
  // Each retired route lands on the workbench with its mapped view state and keeps its own parameters (LLD §5.3).
  for (const [route, expected] of [
    ["graph", { view: "flow", renderer: "2d" }],
    ["deployment-planner", { view: "topology", policy: "all-shapes" }],
    ["signing", { view: "flow", overlays: "security", panel: "compile" }],
    ["audit", { view: "flow", overlays: "compliance", panel: "compile" }],
    ["intents", { view: "flow", panel: "history" }],
    ["diff", { view: "flow", panel: "compile" }]
  ]) {
    await page.goto(`${base}/components/fabric-studio/${route}?tenantId=tenant-a&assemblyId=assembly-one${route === "deployment-planner" ? "&policy=all-shapes" : ""}`);
    await page.waitForURL(url => url.pathname === "/components/fabric-studio/workspace");
    const params = new URL(page.url()).searchParams;
    for (const [key, value] of Object.entries({ tenantId: "tenant-a", ...expected })) assert.equal(params.get(key), value, `${route}: ${key}`);
  }
  await page.goto(`${base}/components/fabric-studio/intents?tenantId=tenant-a&assemblyId=assembly-one`);
  await page.getByText("Start or open a draft to see its validated intent history.", { exact: false }).waitFor();
  assert.deepEqual(errors, []);

  // Regression (Studio LLD §4.3 rule 6, §6): loading an assembly snapshot replaces the open session. A compile of the
  // previous session must not survive, even at the same revision, and the snapshot's layout must be shown and saved.
  const { createMockStudioApiFetch } = await import(pathToFileURL(resolve("packages/fabric-validation-client/dist/index.js")).href);
  const mockFetch = createMockStudioApiFetch();
  const snapshotPage = await browser.newPage();
  const layoutWrites = [];
  let failCompile = false;
  let failProjection = false;
  await snapshotPage.route("**/studio/**", async route => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/layout")) layoutWrites.push(JSON.parse(request.postData() ?? "{}"));
    if (failProjection && new URL(request.url()).pathname.endsWith("/dynamic-dcp")) {
      return route.fulfill({ status: 503, json: { error: "projection unavailable" } });
    }
    if (failCompile && request.method() === "POST" && new URL(request.url()).pathname.endsWith("/compile")) {
      return route.fulfill({ status: 503, json: { error: "compile unavailable" } });
    }
    const response = await mockFetch(request.url(), { method: request.method(), body: request.postData() ?? undefined });
    return route.fulfill({ status: response.status, json: response.ok ? await response.json() : { error: response.statusText } });
  });
  const assemblyProjection = snapshotPage.waitForResponse(response => new URL(response.url()).pathname.endsWith("/dynamic-dcp")
    && !new URL(response.url()).searchParams.has("sessionId"));
  await snapshotPage.goto(`${base}/components/fabric-studio/workspace?tenantId=tenant-local&assemblyId=assembly-demo&panel=compile`);
  await assemblyProjection;
  await snapshotPage.waitForFunction(() => !document.body.innerText.includes("Loading Fabric's projection"));
  // Regression (§4.3 rule 6): when the projection for the new session fails to load, the assembly's earlier projection is
  // named as out of date and never drawn as the draft's; Retry loads the current one.
  failProjection = true;
  await snapshotPage.getByRole("button", { name: "New Draft" }).click();
  await snapshotPage.getByText("synced at revision 7", { exact: false }).waitFor();
  await snapshotPage.getByText("could not be loaded", { exact: false }).waitFor();
  assert.match(await snapshotPage.locator(".workbench-stage-empty").innerText(),
    /revision 7 of session studio-session-123 could not be loaded[\s\S]*for assembly assembly-demo, is out of date and is not shown/);
  assert.equal(await snapshotPage.locator(".composition-plane").count(), 0, "the out-of-date projection is not drawn");
  failProjection = false;
  await snapshotPage.getByRole("button", { name: "Retry", exact: true }).click();
  await snapshotPage.waitForFunction(() => !document.querySelector(".workbench-stage-empty"));
  await snapshotPage.getByRole("button", { name: "Compile & Validate" }).click();
  await snapshotPage.getByText("7 of session studio-session-123", { exact: true }).waitFor();
  // Regression (§4.3 rule 6): after a policy change, a failed compile must not re-pin the earlier result to the new policy.
  await snapshotPage.getByRole("tab", { name: "Substrate & Topology" }).click();
  await snapshotPage.getByRole("button", { name: "Remote microservice", exact: true }).click();
  await snapshotPage.getByText("with a different deployment policy", { exact: false }).first().waitFor();
  failCompile = true;
  await snapshotPage.getByRole("button", { name: "Compile & Validate" }).click();
  await snapshotPage.getByText("FABRIC_REQUEST_FAILED", { exact: true }).waitFor();
  assert.equal(await snapshotPage.getByText("7 of session studio-session-123", { exact: true }).count(), 0,
    "a failed compile does not make the earlier result current");
  assert.ok(await snapshotPage.getByText("Out of date: the compiled contract", { exact: false }).count() > 0);
  assert.equal(await snapshotPage.getByText("COMPILE_READY", { exact: true }).count(), 0, "no compile card from an out-of-date result");
  failCompile = false;
  await snapshotPage.getByRole("button", { name: "Compile & Validate" }).click();
  await snapshotPage.getByText("7 of session studio-session-123", { exact: true }).waitFor();
  assert.equal(await snapshotPage.getByText("FABRIC_REQUEST_FAILED", { exact: true }).count(), 0, "the next success clears the failure");
  await snapshotPage.getByRole("tab", { name: "Flow & Composition" }).click();
  const imported = {
    tenantId: "tenant-local", assemblyId: "assembly-demo",
    assembly: { tenantId: "tenant-local", assemblyId: "assembly-demo", targetApplicationName: "Imported", defaultDeploymentTarget: "",
      needsId: "", deploymentShape: "CONTAINERIZED_SERVICE", currentCandidateId: "", sceneRevision: 7 },
    layout: { tenantId: "tenant-local", assemblyId: "assembly-demo", semanticZoomLevel: "ASSEMBLY_DCP", selectedSurface: "substrate",
      camera: {}, annotations: [], activeViewpoint: "TOPOLOGY", activeOverlays: ["SECURITY"], colourOverlay: "SECURITY", renderer: "TABLE" },
    sessions: [{ tenantId: "tenant-local", assemblyId: "assembly-demo", sessionId: "studio-session-imported", baseCatalogHash: "sha256:catalog",
      sceneRevision: 7, warnings: [], intentLog: [{ type: "ADD_COMPONENT", payload: { catalogEntryId: "com.unfurl:storage:1.0" } }] }]
  };
  await snapshotPage.locator("input[type=file]").setInputFiles({ name: "assembly.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)) });
  await snapshotPage.getByText("Assembly snapshot loaded for assembly-demo.", { exact: false }).waitFor();
  assert.equal(await snapshotPage.getByRole("tab", { name: "Substrate & Topology" }).getAttribute("aria-selected"), "true",
    "the snapshot's view is shown");
  assert.equal(await snapshotPage.getByRole("button", { name: "Table", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await snapshotPage.getByText("of session studio-session-123", { exact: false }).count(), 0,
    "the previous session's compile is cleared, even at the same revision");
  assert.equal(await snapshotPage.getByText("Out of date: the compiled contract", { exact: false }).count(), 0,
    "cleared on replacement, not merely reported out of date");
  await snapshotPage.waitForTimeout(500);
  const lastWrite = layoutWrites.at(-1);
  assert.equal(lastWrite?.activeViewpoint, "TOPOLOGY", "autosave writes the imported layout, not the previous one");
  assert.equal(lastWrite?.renderer, "TABLE");
  const inventory = () => snapshotPage.evaluate(() =>
    JSON.parse(localStorage.getItem("unfurl-studio-draft-inventory:tenant-local:assembly-demo") ?? "{}").components);
  assert.deepEqual((await inventory()).map(component => component.catalogEntryId), ["com.unfurl:storage:1.0"]);
  // Regression (§4.3 rule 6): Fabric removes the assembly's sessions on import, so a snapshot without one leaves no
  // open session: the removed session and its inventory are cleared and no command can target it.
  await snapshotPage.locator("input[type=file]").setInputFiles({ name: "empty.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...imported, sessions: [] })) });
  await snapshotPage.getByText("Start a draft to compile.", { exact: true }).waitFor();
  assert.equal(await snapshotPage.getByRole("button", { name: "Compile & Validate" }).isDisabled(), true);
  assert.equal(await snapshotPage.locator(".workbench-bottom div", { hasText: "Revision" }).locator("span").innerText(), "no draft");
  await snapshotPage.waitForFunction(() =>
    JSON.parse(localStorage.getItem("unfurl-studio-draft-inventory:tenant-local:assembly-demo") ?? "{}").components?.length === 0);

  // Regression (Studio LLD §5.7 rule 1): a 2D node box lays its fact lines out one below another inside the box. Only the
  // boxes are placed absolutely; a rule that also placed the nested fact lines stacked them all at one position.
  const layoutPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const layoutFetch = createMockStudioApiFetch();
  await layoutPage.route("**/studio/**", async route => {
    const request = route.request();
    const response = await layoutFetch(request.url(), { method: request.method(), body: request.postData() ?? undefined });
    return route.fulfill({ status: response.status, json: response.ok ? await response.json() : { error: response.statusText } });
  });
  await layoutPage.goto(`${base}/components/fabric-studio/workspace?tenantId=tenant-local&assemblyId=assembly-demo&view=topology&renderer=2d`);
  await layoutPage.locator(".workbench-2d-nodes > li").first().waitFor();
  // Drill into the assembly so its components, each with Topology's four facts, are drawn.
  await layoutPage.locator(".zoom-tile").first().click();
  await layoutPage.waitForFunction(() => [...document.querySelectorAll(".workbench-2d-nodes > li")]
    .some(box => box.querySelectorAll(".node-facts > li").length >= 4));
  const boxes = await layoutPage.locator(".workbench-2d-nodes > li").evaluateAll(items => items.map(box => {
    const outer = box.getBoundingClientRect();
    const lines = [...box.querySelectorAll(".node-facts > li")].map(line => {
      const rect = line.getBoundingClientRect();
      return { text: line.textContent, top: rect.top, bottom: rect.bottom, position: getComputedStyle(line).position };
    });
    return { id: box.querySelector("[data-element-id]")?.getAttribute("data-element-id"), top: outer.top, bottom: outer.bottom,
      left: outer.left, right: outer.right, lines };
  }));
  const withFacts = boxes.filter(box => box.lines.length >= 2);
  assert.ok(withFacts.length > 0, "the drilled-in Topology view draws boxes with several facts");
  for (const box of withFacts) {
    for (const line of box.lines) assert.equal(line.position, "static", `${box.id}: a fact line flows inside its box`);
    for (let i = 1; i < box.lines.length; i++) {
      assert.ok(box.lines[i].top >= box.lines[i - 1].bottom - 0.5,
        `${box.id}: "${box.lines[i].text}" starts below "${box.lines[i - 1].text}"`);
    }
    assert.ok(box.lines[0].top >= box.top, `${box.id}: the facts start inside the box`);
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.ok(!overlap, `${a.id} and ${b.id} do not overlap`);
    }
  }
  await layoutPage.close();

  const hosted = await browser.newPage();
  await hosted.addInitScript(origin => {
    const compatibility = { hostShell: ">=1.0.0 <2.0.0", hostShellApi: ">=1.0.0 <2.0.0", microAppProps: ">=1.0.0 <2.0.0",
      eventBus: ">=1.0.0 <2.0.0", themeSystem: ">=1.0.0 <2.0.0", componentContract: "test@1" };
    /** Test fixture Factory: create two explicitly approved deployment manifests. */
    const manifest = (id, title, route, key) => ({ component: { id, name: title, version: "1.0.0" },
      webapp: { type: "single-spa-application", name: key, routePrefix: route, importMap: { key },
        navigation: { section: "Test", title, icon: "box", order: 0 }, permissions: ["studio.view"] }, compatibility });
    window.unfurlHost = {
      authentication: "authenticated", approvedBundleUrls: [`${origin}/approved-test.js`],
      registry: { manifests: [manifest("fabric-studio", "Studio", "/components/fabric-studio", "studio"),
        manifest("test", "Test app", "/components/test", "test")], importMap: { imports: { studio: "bundled:studio", test: `${origin}/approved-test.js` } } },
      baseTheme: { id: "test", name: "Test", tokens: { background: "#123456" } }, themePolicy: { mode: "host-only" },
      context: { tenantId: "tenant-a", user: { id: "user-a", roles: [], permissions: ["studio.view"] },
        auth: { getAccessToken: async () => "test-only-token" }, api: { platformBaseUrl: origin, componentBaseUrls: { "fabric-studio": origin } },
        theme: { activeThemeId: "test", mode: "host", tokens: {} }, eventBus: { publish() {}, subscribe() { return () => {}; } } }
    };
  }, base);
  await hosted.route("**/approved-test.js", route => route.fulfill({ contentType: "text/javascript", body:
    'export async function bootstrap() {} export async function mount(p) {p.domElement.textContent="Independent lifecycle app";} export async function unmount(p) {p.domElement.textContent="";window.testUnmounted=true;}' }));
  const tokens = [];
  await hosted.route("**/studio/**", route => {
    tokens.push(route.request().headers().authorization);
    return route.fulfill({ json: { catalogHash: "hash", entries: [] } });
  });
  await hosted.goto(`${base}/components/test`);
  await hosted.getByText("Independent lifecycle app", { exact: true }).waitFor();
  assert.equal(await hosted.locator(".app-shell").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(18, 52, 86)");
  await hosted.getByRole("link", { name: "Catalog", exact: true }).click();
  await hosted.getByRole("heading", { name: "Catalog Palette" }).waitFor();
  await hosted.waitForFunction(() => window.testUnmounted === true);
  await hosted.waitForFunction(() => document.body.innerText.includes("catalog loaded") || document.querySelector(".studio-page"));
  await new Promise(done => setTimeout(done, 300));
  assert.ok(tokens.length > 0); assert.ok(tokens.every(token => token === "Bearer test-only-token"));
  console.log("Browser gate passed: isolated workspace caches, Studio's three entries, retired-route redirects, view reasons, failed-refresh projection freshness, failed-compile freshness, snapshot replacement (with and without a session), 2D fact-line layout, independent lifecycle mount/unmount, host theme and bearer authentication.");
} finally {
  await browser?.close(); server.kill();
}
