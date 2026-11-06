import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * One project per package. `@suite/sync` covers both the pure root and the
 * `./loro` subpath; the server is a CLI and a transport. The aliases point the
 * tests at source, so a test run does not depend on a prior build; the published
 * package has only `dist`, which is what a git consumer installs.
 */
const protocolRoot = fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url));
const protocolLoro = fileURLToPath(
  new URL("./packages/protocol/src/loro/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: "@suite/sync/loro", replacement: protocolLoro },
      { find: /^@suite\/sync$/u, replacement: protocolRoot },
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
          name: "server",
          environment: "node",
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
    ],
  },
});
