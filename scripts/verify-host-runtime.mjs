import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
  await page.route("**/studio/**", route => route.fulfill({ json: route.request().url().includes("/files") ? []
    : route.request().url().includes("/catalog") ? { catalogHash: "hash", entries: [] } : { nodes: [], edges: [], warnings: [] } }));
  await page.goto(`${base}/components/fabric-studio/workspace?tenantId=tenant-a&assemblyId=assembly-one`);
  await page.getByRole("button", { name: "Apply workspace scope" }).waitFor();
  assert.match(await page.locator("body").innerText(), /Private A/);
  await page.getByLabel("Tenant", { exact: true }).fill("tenant-b");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("unfurl-studio-draft-inventory:tenant-b:assembly-one")).components[0].label), "Private B");
  await page.getByRole("button", { name: "Apply workspace scope" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Private B"));
  assert.doesNotMatch(await page.locator("body").innerText(), /Private A/);
  await page.getByRole("link", { name: "Diff", exact: true }).click();
  await page.getByText("Authoritative revision artifacts are unavailable.", { exact: false }).waitFor();
  await page.getByRole("link", { name: "Intents", exact: true }).click();
  await page.getByText("Authoritative intent history is unavailable.", { exact: false }).waitFor();
  assert.deepEqual(errors, []);

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
  console.log("Browser gate passed: isolated workspace caches, live data honesty, independent lifecycle mount/unmount, host theme and bearer authentication.");
} finally {
  await browser?.close(); server.kill();
}
