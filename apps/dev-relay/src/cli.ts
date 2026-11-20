import { startDevRelay } from "./server.js";

const args = process.argv.slice(2);
const enforceSuccession = !args.includes("--no-enforce");
const positional = args.filter((arg) => !arg.startsWith("--"));
const port = Number(positional[0] ?? process.env.PORT ?? 7777);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("usage: dev-relay [port] [--no-enforce]");
  process.exit(1);
}

const { url } = await startDevRelay({ port, enforceSuccession });
console.log(`Local Nostr relay listening on ${url}`);
console.log("Events are kept in memory and lost when this process stops.");
console.log(
  enforceSuccession
    ? "BND bindings must verify and can only be replaced by a successor (--no-enforce turns this off)."
    : "BND rules are off: any signed event is stored.",
);
