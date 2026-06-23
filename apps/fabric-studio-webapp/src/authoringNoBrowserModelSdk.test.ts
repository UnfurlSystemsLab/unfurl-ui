import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

describe("AI authoring browser boundary", () => {
  it("does not import model SDKs or provider key fields into the webapp", () => {
    const source = readSourceFiles(resolve(dirname(fileURLToPath(import.meta.url)), "../src"));

    assert.doesNotMatch(source, /from\s+["'](?:openai|@anthropic-ai\/sdk|langchain|@langchain\/[^"']+)["']/i);
    assert.doesNotMatch(source, /apiKey|providerKey|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
  });
});

function readSourceFiles(root: string): string {
  return readdirSync(root).flatMap(entry => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return entry === "dist" ? [] : [readSourceFiles(path)];
    }
    if (entry === "authoringNoBrowserModelSdk.test.ts" || !/\.(ts|tsx)$/.test(entry)) {
      return [];
    }
    return [readFileSync(path, "utf8")];
  }).join("\n");
}
