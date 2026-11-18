import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The page and the verifier share one origin: these paths go to the verifier.
const VERIFIER_ROUTES = ["/challenge", "/login", "/me", "/logout"];

export default defineConfig(({ mode }) => {
  // `.env` lives at the repository root, next to `.env.example`.
  const env = loadEnv(mode, root("../.."), "");
  const verifier = env.VERIFIER_URL ?? `http://127.0.0.1:${env.PORT ?? "8787"}`;
  const proxy = Object.fromEntries(
    VERIFIER_ROUTES.map((route) => [route, { target: verifier, changeOrigin: false }]),
  );
  return {
    envDir: root("../.."),
    plugins: [react()],
    resolve: {
      // Use package sources directly, as the tests do, so no build step is needed first.
      alias: {
        "@cashlet-labs/bnd-core": root("../../packages/core/src/index.ts"),
        "@cashlet-labs/bnd-nostr": root("../../packages/nostr/src/index.ts"),
      },
    },
    build: { target: "es2022", sourcemap: true },
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
  };
});
