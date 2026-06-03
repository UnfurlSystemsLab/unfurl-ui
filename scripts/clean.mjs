import { rm } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "packages"];

for (const root of roots) {
  const entries = await import("node:fs/promises").then(fs => fs.readdir(root, { withFileTypes: true }).catch(() => []));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await rm(join(root, entry.name, "dist"), { recursive: true, force: true });
      await rm(join(root, entry.name, "tsconfig.tsbuildinfo"), { recursive: false, force: true });
    }
  }
}
