import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "node:test";

const roots = ["apps", "packages"];
const testFiles = [];

for (const root of roots) {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) {
      continue;
    }
    const dist = join(root, project.name, "dist");
    const files = await readdir(dist).catch(() => []);
    for (const file of files) {
      if (file.endsWith(".test.js")) {
        testFiles.push(join(dist, file));
      }
    }
  }
}

if (testFiles.length === 0) {
  console.log("No compiled test files found.");
  process.exit(0);
}

run({ files: testFiles })
  .on("test:fail", () => {
    process.exitCode = 1;
  })
  .on("end", () => {
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
  });
