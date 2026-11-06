import { defineConfig } from "vitest/config";

/**
 * One project per package. `@suite/sync` covers both the pure root and the
 * `./loro` subpath; the server is a CLI and a transport. The `development`
 * condition resolves a workspace package to its `src`, so a test run does not
 * depend on a prior build.
 */
export default defineConfig({
  resolve: {
    conditions: ["development", "import", "default"],
  },
  test: {
    testTimeout: 15_000,
    projects: [
      {
        test: {
          name: "protocol",
          environment: "node",
          include: ["packages/protocol/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
    ],
  },
});
