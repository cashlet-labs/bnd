#!/usr/bin/env node
// bnd-resolve <did:bnd:…> [--relay wss://…]… [--min N]
// Prints the DID Resolution Result as JSON. Exits 1 when resolution fails.
import { DEFAULT_RELAYS } from "../nostr/index.js";
import { resolveDid } from "./resolve.js";

const args = process.argv.slice(2);
const relays: string[] = [];
let minComplete: number | undefined;
let did: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--relay") relays.push(args[++i] ?? "");
  else if (arg === "--min") minComplete = Number(args[++i]);
  else if (arg === "--help" || arg === "-h") did = undefined;
  else did = arg;
}
if (did === undefined) {
  console.error("usage: bnd-resolve <did:bnd:…> [--relay wss://…]… [--min N]");
  process.exit(2);
}
const useRelays = relays.length > 0 ? relays : [...DEFAULT_RELAYS];
const result = await resolveDid(did, {
  relays: useRelays,
  minComplete: minComplete ?? Math.min(2, useRelays.length),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit("error" in result.didResolutionMetadata ? 1 : 0);
