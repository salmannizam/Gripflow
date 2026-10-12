/**
 * Packs every publishable package into artifacts/tarballs using `npm pack`.
 * Order matters only for humans reading the output; tarballs are independent files.
 * Nothing here talks to the registry.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "artifacts", "tarballs");
mkdirSync(out, { recursive: true });

const packages = ["core", "react", "tree", "kanban", "presets", "nestjs-adapter"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const dry = process.argv.includes("--dry-run");

for (const name of packages) {
  const dir = join(root, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!existsSync(join(dir, "dist"))) {
    console.error(`packages/${name} has no dist/. Run "npm run build" first.`);
    process.exit(1);
  }
  // Each published package ships the repository LICENSE (and the README written for it).
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  const args = ["pack", "--pack-destination", out, ...(dry ? ["--dry-run"] : [])];
  console.log(`\n== ${pkg.name}@${pkg.version} ==`);
  execFileSync(npm, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
}
console.log(dry ? "\nDry run finished." : `\nTarballs written to ${out}`);
