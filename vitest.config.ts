import { defineConfig } from "vitest/config";

/**
 * One project per package. The protocol is pure; the client needs Loro; the
 * server is a CLI. The `development` condition resolves a workspace package to
 * its `src`, so a test run does not depend on a prior build.
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
          name: "client",
          environment: "node",
          include: ["packages/client/src/**/*.test.ts"],
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
