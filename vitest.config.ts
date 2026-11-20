import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tests run against package sources, so no build step is needed first.
const alias = {
  "@cashlet-labs/bnd-core": src("./packages/core/src/index.ts"),
  "@cashlet-labs/bnd-nostr/testing": src("./packages/nostr/src/testing.ts"),
  "@cashlet-labs/bnd-nostr": src("./packages/nostr/src/index.ts"),
  "@cashlet-labs/bnd-did": src("./packages/did/src/index.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: [
            "packages/*/test/**/*.test.ts",
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
