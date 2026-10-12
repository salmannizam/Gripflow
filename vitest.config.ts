import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Tests run against package sources so no build is needed. */
export const workspaceAliases = {
  "@gripflow/core": p("./packages/core/src/index.ts"),
  "@gripflow/react": p("./packages/react/src/index.ts"),
  "@gripflow/tree/react": p("./packages/tree/src/react/index.ts"),
  "@gripflow/tree": p("./packages/tree/src/index.ts"),
  "@gripflow/kanban/react": p("./packages/kanban/src/react/index.ts"),
  "@gripflow/kanban": p("./packages/kanban/src/index.ts"),
  "@gripflow/presets": p("./packages/presets/src/index.ts"),
  "@gripflow/nestjs-adapter": p("./packages/nestjs-adapter/src/index.ts"),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // Pure tests run in node; DOM tests opt in with `// @vitest-environment jsdom`.
    environment: "node",
  },
});
