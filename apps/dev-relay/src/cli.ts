import { startDevRelay } from "./server.js";

const port = Number(process.argv[2] ?? process.env.PORT ?? 7777);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("usage: dev-relay [port]");
  process.exit(1);
}

const { url } = await startDevRelay({ port });
console.log(`Local Nostr relay listening on ${url}`);
console.log("Events are kept in memory and lost when this process stops.");
