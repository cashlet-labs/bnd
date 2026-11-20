import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { LOCAL_DEMO_RELAY, parseRelayList, securityHeaders } from "./security-headers.js";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The page and the verifier share one origin: these paths go to the verifier.
// /did/ is the public did:bnd resolver.
const VERIFIER_ROUTES = ["/challenge", "/login", "/me", "/logout", "/did/"];

export default defineConfig(({ mode }) => {
  // `.env` lives at the repository root, next to `.env.example`.
  const env = { ...loadEnv(mode, root("../.."), ""), ...process.env };
  const verifier = env.VERIFIER_URL ?? `http://127.0.0.1:${env.PORT ?? "8787"}`;
  const siteRelays = parseRelayList(env.VITE_RELAYS, [LOCAL_DEMO_RELAY]);
  const proxy = Object.fromEntries(
    VERIFIER_ROUTES.map((route) => [route, { target: verifier, changeOrigin: false }]),
  );
  return {
    envDir: root("../.."),
    plugins: [
      // File-based routes in src/routes; each route's page is loaded when first visited.
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: root("./src/routes"),
        generatedRouteTree: root("./src/routeTree.gen.ts"),
        // Match the repository's Prettier style, so formatting the file by
        // accident changes nothing.
        quoteStyle: "double",
        semicolons: true,
      }),
      react(),
    ],
    resolve: {
      // Use package sources directly, as the tests do, so no build step is needed first.
      // Exact matches: a plain "@cashlet-labs/bnd" key would also catch its subpaths.
      alias: [
        {
          find: /^@cashlet-labs\/bnd\/nostr$/,
          replacement: root("../../packages/bnd/src/nostr/index.ts"),
        },
        {
          find: /^@cashlet-labs\/bnd\/did$/,
          replacement: root("../../packages/bnd/src/did/index.ts"),
        },
        {
          find: /^@cashlet-labs\/bnd\/testing$/,
          replacement: root("../../packages/bnd/src/nostr/testing.ts"),
        },
        { find: /^@cashlet-labs\/bnd$/, replacement: root("../../packages/bnd/src/core/index.ts") },
      ],
    },
    build: { target: "es2022", sourcemap: true },
    // The dev server needs inline scripts and its own socket for reloads, so the
    // strict policy applies to the built page served by `vite preview`.
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy,
      headers: securityHeaders(siteRelays),
    },
  };
});
