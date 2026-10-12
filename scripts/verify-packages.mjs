/**
 * Static checks on the built packages. Run after `npm run build`.
 *  - every `exports` target exists
 *  - every bare import in dist is declared as a dependency or peer dependency
 *  - no workspace: / file: specs, no leaked source paths
 *  - "use client" is on React bundles and absent from pure bundles
 *  - React is never bundled
 *  - the npm tarball contains no source, tests, env files or oversized assets
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const names = ["core", "react", "tree", "kanban", "presets", "nestjs-adapter"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const problems = [];
const warnings = [];
const fail = (pkg, msg) => problems.push(`${pkg}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function collectTargets(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectTargets(v, out));
  return out;
}

function bareImports(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s*["']([^"'./][^"']*)["']/g,
    /\bimport\s*["']([^"'./][^"']*)["']/g,
    /\brequire\(\s*["']([^"'./][^"']*)["']\s*\)/g,
    /\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.add(m[1]);
  return found;
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

for (const name of names) {
  const dir = join(root, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const label = pkg.name;
  const dist = join(dir, "dist");
  if (!existsSync(dist)) {
    fail(label, "dist/ is missing (run the build)");
    continue;
  }

  for (const target of collectTargets(pkg.exports)) {
    if (target.startsWith("./") && !existsSync(join(dir, target))) fail(label, `exports target missing: ${target}`);
  }
  for (const field of ["main", "module", "types"]) {
    if (pkg[field] && !existsSync(join(dir, pkg[field]))) fail(label, `"${field}" target missing: ${pkg[field]}`);
  }

  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dep, spec] of Object.entries(pkg[section] ?? {})) {
      if (/^(workspace|file|link):/.test(spec)) fail(label, `${section}.${dep} uses "${spec}"`);
    }
  }
  if (!pkg.license) fail(label, "missing license");
  if (pkg.repository?.url?.includes("REPLACE-ME")) warnings.push(`${label}: repository.url is still a placeholder`);

  const files = walk(dist);
  for (const file of files) {
    const rel = relative(dir, file).replaceAll("\\", "/");
    if (/\.(c?js|mjs)$/.test(file)) {
      const source = readFileSync(file, "utf8");
      for (const spec of bareImports(source)) {
        const base = packageName(spec);
        if (builtins.has(spec) || builtins.has(base)) continue;
        if (!declared.has(base)) fail(label, `${rel} imports undeclared "${spec}"`);
      }
      if (/__SECRET_INTERNALS|react\.production|react-dom\.production/.test(source)) {
        fail(label, `${rel} appears to bundle React`);
      }
      if (/\/Gripflow\/|\\Gripflow\\|packages\/[a-z-]+\/src/.test(source.replace(/\/\/# sourceMappingURL.*/, ""))) {
        fail(label, `${rel} references repository source paths`);
      }
      const isReactBundle = /(^|\/)react\//.test(rel) || ["react", "presets"].includes(name);
      const hasDirective = /^["']use client["'];/.test(source);
      if (isReactBundle && !hasDirective) fail(label, `${rel} is missing the "use client" directive`);
      if (!isReactBundle && hasDirective) fail(label, `${rel} must not have "use client"`);
    }
    if (/\.d\.c?ts$/.test(file)) {
      const source = readFileSync(file, "utf8");
      for (const spec of bareImports(source)) {
        const base = packageName(spec);
        if (builtins.has(base)) continue;
        if (!declared.has(base) && !spec.startsWith("react")) fail(label, `${rel} imports undeclared type package "${spec}"`);
      }
    }
  }

  // Inspect the exact tarball contents without writing anything.
  let listing;
  try {
    const raw = execFileSync(npm, ["pack", "--dry-run", "--json"], {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    listing = JSON.parse(raw)[0];
  } catch (error) {
    fail(label, `npm pack --dry-run failed: ${error.message}`);
    continue;
  }
  for (const f of listing.files) {
    if (/(^|\/)(src|test|tests)\//.test(f.path)) fail(label, `tarball includes ${f.path}`);
    if (/(^|\/)\.env|\.pem$|\.key$|credentials/i.test(f.path)) fail(label, `tarball includes sensitive-looking file ${f.path}`);
    if (f.size > 500_000) fail(label, `tarball includes a large file ${f.path} (${f.size} bytes)`);
  }
  console.log(
    `${label}@${pkg.version}: ${listing.files.length} files, ${(listing.size / 1024).toFixed(1)} kB packed, ${(listing.unpackedSize / 1024).toFixed(1)} kB unpacked`,
  );
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length > 0) {
  console.error("\nPackage verification FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nAll package checks passed.");
