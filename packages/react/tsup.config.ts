import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  external: ["react", "react-dom", "react/jsx-runtime", "@gripflow/core"],
  // Hooks and providers must live in Client Components under the Next.js App Router.
  banner: { js: '"use client";' },
});
