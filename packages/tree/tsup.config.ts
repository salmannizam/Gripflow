import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as ("esm" | "cjs")[],
  dts: true,
  sourcemap: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  external: ["react", "react-dom", "react/jsx-runtime", "@gripflow/core", "@gripflow/react"],
};

export default defineConfig([
  // Pure utilities: no directive, safe to import from Server Components.
  { ...shared, entry: { index: "src/index.ts" }, clean: true },
  // React adapter: hooks and providers must live in Client Components.
  {
    ...shared,
    entry: { "react/index": "src/react/index.ts" },
    banner: { js: '"use client";' },
  },
]);
