// Bundles the verifier and the BND packages it uses into one file for the
// container, so the runtime image needs no node_modules.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["apps/verifier/src/cli.ts"],
  outfile: "deploy/verifier/dist/verifier.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Use package sources, as the tests do, rather than built dist folders.
  alias: {
    "@cashlet-labs/bnd-core": "./packages/core/src/index.ts",
    "@cashlet-labs/bnd-nostr": "./packages/nostr/src/index.ts",
  },
  // Some dependencies are CommonJS and call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: "linked",
  logLevel: "info",
});
