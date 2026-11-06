import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * One project per package. The aliases point the tests at source, so a test run does
 * not depend on a prior build; a git consumer installs `dist`, which is what the
 * committed output check protects.
 */
const protocolRoot = fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url));
const hostRoot = fileURLToPath(new URL("./packages/host/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@suite\/sync$/u, replacement: protocolRoot },
      { find: /^@suite\/host$/u, replacement: hostRoot },
    ],
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
          name: "host",
          environment: "node",
          include: ["packages/host/src/**/*.test.ts"],
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
