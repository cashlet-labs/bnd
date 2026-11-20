import { DEFAULT_RELAYS } from "@cashlet-labs/bnd/nostr";
import { startVerifier } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const relays = (process.env.BND_RELAYS ?? DEFAULT_RELAYS.join(","))
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const minComplete = Number(process.env.BND_MIN_RELAYS ?? 2);

const verifier = await startVerifier({
  port,
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
  ...(process.env.BND_CLIENT_IP_HEADER ? { clientIpHeader: process.env.BND_CLIENT_IP_HEADER } : {}),
  ...(process.env.PUBLIC_URL ? { publicUrl: process.env.PUBLIC_URL } : {}),
  currency: { relays, minComplete },
  ...(process.env.BND_LOG === "off" ? { log: false as const } : {}),
});
console.log(`BND verifier listening on ${verifier.url}`);
console.log(`Checking bindings on ${relays.join(", ")} (at least ${minComplete} must answer)`);
