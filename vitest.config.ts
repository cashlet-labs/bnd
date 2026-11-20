import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tests run against package sources, so no build step is needed first.
// Exact matches: a plain "@cashlet-labs/bnd" key would also catch its subpaths.
const alias = [
  { find: /^@cashlet-labs\/bnd\/nostr$/, replacement: src("./packages/bnd/src/nostr/index.ts") },
  { find: /^@cashlet-labs\/bnd\/did$/, replacement: src("./packages/bnd/src/did/index.ts") },
  {
    find: /^@cashlet-labs\/bnd\/testing$/,
    replacement: src("./packages/bnd/src/nostr/testing.ts"),
  },
  { find: /^@cashlet-labs\/bnd$/, replacement: src("./packages/bnd/src/core/index.ts") },
];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: [
            "packages/bnd/test/**/*.test.ts",
            "apps/dev-relay/test/**/*.test.ts",
            "apps/verifier/test/**/*.test.ts",
            "test/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "web",
          include: ["apps/web/test/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
