import { it } from "node:test";
import assert from "node:assert/strict";
import { createHttpStudioFabricClient } from "./httpClient.js";

it("uses refreshed host credentials on each request and never puts tokens in URLs", async () => {
  const headers: unknown[] = []; let generation = 0;
  const client = createHttpStudioFabricClient({ baseUrl: "https://fabric.test", getAccessToken: async () => `token-${++generation}`,
    fetch: async (url, init) => { assert.doesNotMatch(url, /token-/); headers.push(init?.headers?.Authorization);
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ entries: [], catalogHash: "hash" }) }; } });
  await client.listCatalogVisuals(); await client.listCatalogVisuals();
  assert.deepEqual(headers, ["Bearer token-1", "Bearer token-2"]);
});

it("fails before network dispatch for a missing host token", async () => {
  let calls = 0;
  const client = createHttpStudioFabricClient({ baseUrl: "https://fabric.test", getAccessToken: async () => " ",
    fetch: async () => { calls++; throw Error(); } });
  await assert.rejects(client.listCatalogVisuals(), /empty access token/); assert.equal(calls, 0);
});
