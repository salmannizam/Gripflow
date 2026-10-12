import { rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const targets = ["artifacts", "coverage", "playwright-report", "test-results"];

for (const dir of ["packages", "apps"]) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base)) {
    for (const out of ["dist", ".next", "out", "tsconfig.tsbuildinfo"]) {
      targets.push(join(dir, name, out));
    }
  }
}

for (const target of targets) {
  rmSync(join(root, target), { recursive: true, force: true });
}
console.log("Cleaned build outputs.");
