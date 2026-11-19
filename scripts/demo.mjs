#!/usr/bin/env node
// Runs the whole demo on this machine: a local relay, the verifier and the web
// page, all on loopback. Stop it with Ctrl+C; it stops only what it started.
//
//   node scripts/demo.mjs        builds the page and serves it with the strict
//                                security headers (`npm run demo`)
//   node scripts/demo.mjs --dev  serves the sources with hot reload and without
//                                the strict headers (`npm run dev`)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

const RELAY_PORT = Number(process.env.DEMO_RELAY_PORT ?? 7777);
const VERIFIER_PORT = Number(process.env.PORT ?? 8787);
const DEV = process.argv.includes("--dev");
const WEB_PORT = DEV ? 5173 : 4173;
const relayUrl = `ws://127.0.0.1:${RELAY_PORT}`;
const webUrl = `http://127.0.0.1:${WEB_PORT}`;

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => server.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

for (const [name, port] of [
  ["relay", RELAY_PORT],
  ["verifier", VERIFIER_PORT],
  ["web page", WEB_PORT],
]) {
  if (!(await portIsFree(port))) {
    console.error(
      `Port ${port} for the ${name} is in use. Stop whatever uses it, or change the port.`,
    );
    process.exit(1);
  }
}

const tsx = `${root}node_modules/.bin/tsx`;
const vite = `${root}node_modules/.bin/vite`;
const env = {
  ...process.env,
  PORT: String(VERIFIER_PORT),
  PUBLIC_URL: webUrl,
  // The demo checks logins against its own single relay, whatever `.env` sets
  // for a stand-alone verifier.
  BND_RELAYS: relayUrl,
  BND_MIN_RELAYS: "1",
  VERIFIER_URL: `http://127.0.0.1:${VERIFIER_PORT}`,
  VITE_LOCAL_RELAY: relayUrl,
};

function run(command, args, options = {}) {
  return spawn(command, args, { cwd: root, env, stdio: "inherit", ...options });
}

if (!DEV) {
  console.log("Building the web page…");
  const build = run(vite, ["build", "apps/web"]);
  const built = await new Promise((resolve) => build.once("exit", (code) => resolve(code === 0)));
  if (!built) {
    console.error("The build failed.");
    process.exit(1);
  }
}

const children = [
  run(tsx, ["apps/dev-relay/src/cli.ts", String(RELAY_PORT)]),
  run(tsx, ["apps/verifier/src/cli.ts"]),
  DEV ? run(vite, ["apps/web"]) : run(vite, ["preview", "apps/web"]),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
for (const child of children) {
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`A demo process stopped (exit ${code}); stopping the others.`);
      stop(1);
    }
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

console.log(
  `\n${DEV ? "Dev server" : "Demo"}: open ${webUrl}\nRelay: ${relayUrl}\nPress Ctrl+C to stop.\n`,
);
