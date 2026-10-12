import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  external: ["@gripflow/core", "@gripflow/kanban", "@gripflow/tree"],
});
