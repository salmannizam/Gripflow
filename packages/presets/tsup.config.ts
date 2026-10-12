import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  external: ["react", "react-dom", "react/jsx-runtime", "@gripflow/core", "@gripflow/react"],
  banner: { js: '"use client";' },
  onSuccess: async () => {
    mkdirSync("dist", { recursive: true });
    copyFileSync("src/styles.css", "dist/styles.css");
  },
});
