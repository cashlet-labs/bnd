import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against package sources, so no build step is needed first.
    alias: {
      "@cashlet-labs/bnd-core": src("./packages/core/src/index.ts"),
      "@cashlet-labs/bnd-nostr/testing": src("./packages/nostr/src/testing.ts"),
      "@cashlet-labs/bnd-nostr": src("./packages/nostr/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
